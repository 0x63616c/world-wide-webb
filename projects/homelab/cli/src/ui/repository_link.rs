//! OSC 8 adds native terminal link handling without capturing mouse events.
use std::io::{self, Write};

use crossterm::{cursor, queue, style};
use ratatui::layout::Rect;
use unicode_width::UnicodeWidthStr;

pub(super) struct Link {
    pub area: Rect,
    pub label: String,
    url: String,
}

pub(super) fn layout(area: Rect, brand_width: usize, label: &str) -> Option<Link> {
    let repository = label.strip_prefix("Repo: ")?;
    if !crate::config::valid_repository(repository) || area.width < 40 || area.height < 12 {
        return None;
    }
    let room = usize::from(area.width.saturating_sub(4)).saturating_sub(brand_width + 2);
    if room == 0 {
        return None;
    }
    let label = repository;
    let label = if label.width() > room {
        format!(
            "{}…",
            label
                .chars()
                .take(room.saturating_sub(1))
                .collect::<String>()
        )
    } else {
        label.to_owned()
    };
    let width = label.width() as u16;
    Some(Link {
        area: Rect::new(area.right() - 2 - width, area.y, width, 1),
        label,
        url: format!("https://github.com/{repository}"),
    })
}

pub(super) fn attach(link: &Link, colour: bool) -> io::Result<()> {
    let mut output = io::stdout().lock();
    queue!(
        output,
        cursor::SavePosition,
        cursor::MoveTo(link.area.x, link.area.y),
        style::SetAttribute(style::Attribute::Reset)
    )?;
    if colour {
        queue!(
            output,
            style::SetForegroundColor(if link.label.starts_with('#') {
                style::Color::Grey
            } else {
                style::Color::DarkGrey
            })
        )?;
    }
    queue!(output, style::SetAttribute(style::Attribute::Underlined))?;
    write_label(&mut output, link)?;
    queue!(
        output,
        style::SetAttribute(style::Attribute::Reset),
        style::ResetColor,
        cursor::RestorePosition
    )?;
    output.flush()
}

pub(super) fn commit(frame: &mut ratatui::Frame<'_>, reference: &str) -> Option<Link> {
    let (repository, sha) = reference.split_once('#')?;
    if !crate::config::valid_repository(repository)
        || sha.len() != 8
        || !sha.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    let label = format!("#{sha}");
    let area = frame.area();
    let buffer = frame.buffer_mut();
    for y in area.top()..area.bottom() {
        let text: String = (area.left()..area.right())
            .map(|x| buffer[(x, y)].symbol())
            .collect();
        if let Some(index) = text.find(&label) {
            return Some(Link {
                area: Rect::new(
                    area.x + text[..index].width() as u16,
                    y,
                    label.len() as u16,
                    1,
                ),
                label,
                url: format!("https://github.com/{repository}/commit/{sha}"),
            });
        }
    }
    None
}

fn write_label(output: &mut impl Write, link: &Link) -> io::Result<()> {
    write!(
        output,
        "\x1b]8;;{}\x1b\\{}\x1b]8;;\x1b\\",
        link.url, link.label
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_repository_name_is_inside_the_hyperlink() {
        let link = layout(Rect::new(0, 0, 100, 24), 10, "Repo: example/config").unwrap();
        let mut output = Vec::new();
        write_label(&mut output, &link).unwrap();
        assert_eq!(
            String::from_utf8(output).unwrap(),
            "\x1b]8;;https://github.com/example/config\x1b\\example/config\x1b]8;;\x1b\\"
        );
    }
    #[test]
    fn shortened_label_still_links_to_the_full_validated_repository() {
        let link = layout(
            Rect::new(0, 0, 40, 24),
            10,
            "Repo: example/a-long-repository-name",
        )
        .unwrap();
        assert!(link.label.ends_with('…'));
        assert_eq!(
            link.url,
            "https://github.com/example/a-long-repository-name"
        );
        assert_eq!(link.area.right(), 38);
        assert!(link.area.x >= 14);
    }
    #[test]
    fn control_sequences_and_external_urls_cannot_become_links() {
        for label in [
            "Repo: https://evil.test",
            "Repo: a/b\x1b\\",
            "Repo: a/b\n",
            "Repo: ../repo",
        ] {
            assert!(layout(Rect::new(0, 0, 100, 24), 10, label).is_none());
        }
    }
}
