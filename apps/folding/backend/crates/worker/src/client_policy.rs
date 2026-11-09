//! Compatibility policy, not authentication: callers can forge their build header.
pub const MAX_BUILD: u32 = i32::MAX as u32;

pub fn parse_build(value: &str) -> Option<u32> {
    if value.is_empty() || value.len() > 10 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    value.parse().ok().filter(|n| *n <= MAX_BUILD)
}

pub fn retirement_exempt(method: &str, path: &str) -> bool {
    // Keep a small, stable privacy recovery surface even when business APIs retire.
    matches!(
        path,
        "/v1/client-policy"
            | "/v1/health"
            | "/v1/capabilities"
            | "/v1/auth/challenges"
            | "/v1/auth/apple"
            | "/v1/auth/refresh"
            | "/v1/auth/logout"
            | "/v1/account/delete"
    ) || (method == "GET" && path.starts_with("/v1/operations/"))
        || (method == "DELETE"
            && (path.starts_with("/v1/avatars/") || path.starts_with("/v1/push-installations/")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn build_numbers_are_bounded_and_privacy_recovery_stays_available() {
        assert_eq!(parse_build("12"), Some(12));
        for value in ["", "-1", "+1", "1.2", "2147483648", "999999999999", " 12"] {
            assert_eq!(parse_build(value), None);
        }
        assert!(retirement_exempt("POST", "/v1/account/delete"));
        assert!(retirement_exempt("GET", "/v1/client-policy"));
        assert!(!retirement_exempt("POST", "/v1/event-batches"));
        assert!(!retirement_exempt("GET", "/v1/leaderboards"));
    }
}
