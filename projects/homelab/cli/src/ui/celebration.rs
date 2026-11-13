//! Sparse, persistent stars behind the completed setup panel.
use std::time::Duration;

use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    widgets::Paragraph,
};

pub(super) fn render(frame: &mut Frame<'_>, elapsed: Duration, colour: bool, panel: Rect) {
    let area = frame.area();
    if !colour || area.width < 40 || area.height < 12 {
        return;
    }
    let width = area.width - 4;
    let height = area.height - 6;
    let count = (usize::from(width) * usize::from(height) / 200).clamp(8, 32);
    for index in 0..count {
        let seed = (index as u32 + 1).wrapping_mul(2654435761);
        let x = area.x + 2 + (seed % u32::from(width)) as u16;
        let y = area.y + 3 + ((seed >> 13) % u32::from(height)) as u16;
        if panel.contains((x, y).into()) {
            continue;
        }
        let pulse = ((elapsed.as_secs_f32() * 1.2 + index as f32 * 2.3).sin() + 1.0) / 2.0;
        let (symbol, colour) = if pulse > 0.94 {
            ("✧", Color::White)
        } else if pulse > 0.72 {
            ("·", Color::Gray)
        } else {
            ("·", Color::DarkGray)
        };
        frame.render_widget(
            Paragraph::new(symbol).style(Style::default().fg(colour)),
            Rect::new(x, y, 1, 1),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stars_stay_out_of_content_and_chrome_and_do_not_expire() {
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(100, 35)).unwrap();
        for elapsed in [Duration::from_millis(900), Duration::from_secs(60)] {
            terminal
                .draw(|frame| render(frame, elapsed, true, Rect::new(10, 9, 80, 16)))
                .unwrap();
            let buffer = terminal.backend().buffer();
            assert!(buffer.content.iter().any(|cell| cell.symbol() != " "));
            for y in [0, 1, 2, 32, 33, 34] {
                assert!((0..100).all(|x| buffer[(x, y)].symbol() == " "));
            }
            for y in 9..25 {
                assert!((10..90).all(|x| buffer[(x, y)].symbol() == " "));
            }
        }
    }
}
