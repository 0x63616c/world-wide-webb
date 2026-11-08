//! Host pressure is an admission gate only; never interrupts an owned attempt.
use std::time::Duration;

#[derive(Default)]
pub struct HostPressure {
    last_sample: u64,
    previous_swap: Option<u64>,
    recovering: u8,
    safe: bool,
}
impl HostPressure {
    pub async fn admission_safe(&mut self, now: u64) -> bool {
        if self.last_sample != 0 && now.saturating_sub(self.last_sample) < 10 {
            return self.safe;
        }
        self.last_sample = now;
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::process::Command::new("/usr/sbin/sysctl")
                .args(["-n", "kern.memorystatus_vm_pressure_level", "vm.swapusage"])
                .kill_on_drop(true)
                .output(),
        )
        .await;
        let parsed = match output {
            Ok(Ok(output)) if output.status.success() && output.stdout.len() <= 1024 => {
                std::str::from_utf8(&output.stdout).ok().and_then(parse)
            }
            _ => None,
        };
        self.observe(parsed)
    }
    fn observe(&mut self, sample: Option<(u32, u64)>) -> bool {
        let Some((pressure, swap)) = sample else {
            self.safe = false;
            self.recovering = 0;
            return false;
        };
        let growing = self
            .previous_swap
            .is_some_and(|previous| swap > previous.saturating_add(16 * 1024 * 1024));
        let first = self.previous_swap.is_none();
        self.previous_swap = Some(swap);
        if pressure != 1 || growing {
            self.safe = false;
            self.recovering = 0;
        } else if first {
            self.safe = true;
        } else if !self.safe {
            self.recovering = self.recovering.saturating_add(1);
            self.safe = self.recovering >= 3;
        }
        self.safe
    }
}
fn parse(output: &str) -> Option<(u32, u64)> {
    let mut lines = output.lines();
    let pressure = lines.next()?.parse().ok()?;
    let swap = lines.next()?;
    let used = swap.split_once("used = ")?.1.split_whitespace().next()?;
    let unit = used.chars().last()?;
    let scale = match unit {
        'K' => 1024.,
        'M' => 1024. * 1024.,
        'G' => 1024. * 1024. * 1024.,
        _ => return None,
    };
    let number: f64 = used[..used.len() - 1].parse().ok()?;
    if !number.is_finite() || number < 0. || number * scale > u64::MAX as f64 {
        return None;
    }
    Some((pressure, (number * scale) as u64))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pressure_and_swap_growth_pause_admission_then_require_stable_recovery() {
        let mut gate = HostPressure::default();
        assert!(gate.observe(Some((1, 0))));
        assert!(!gate.observe(Some((2, 0))));
        assert!(!gate.observe(Some((1, 0))));
        assert!(!gate.observe(Some((1, 0))));
        assert!(gate.observe(Some((1, 0))));
        assert!(!gate.observe(Some((1, 32 * 1024 * 1024))));
        assert!(!gate.observe(None));
    }
    #[test]
    fn native_pressure_output_is_bounded_and_invalid_values_fail_closed() {
        assert_eq!(
            parse("1\ntotal = 0.00M  used = 0.00M  free = 0.00M  (encrypted)\n"),
            Some((1, 0))
        );
        assert!(parse("1\nused = NaNM").is_none());
        assert!(parse("1\nused = -1M").is_none());
    }
}
