//! Shared frame and theme. Screens supply presentation data, never side effects.
pub(crate) mod actions;
pub(crate) mod components;
pub(crate) mod loading;
use actions::Action;
mod celebration;
mod repository_link;

use std::cell::RefCell;
use std::io;

use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Alignment, Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::{Frame, Terminal};
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    Heading,
    Context,
    Hint,
    Repository,
    Body,
    Section,
    Field,
    Selected,
    ListOption,
    ListDetail,
    SelectedDetail,
    Input,
    Placeholder,
    Shortcut,
    Action,
    Working,
    Progress,
    Warning,
    Success,
    SuccessTitle,
    Commit,
    Pending,
}

type Renderer = Terminal<CrosstermBackend<io::Stdout>>;
thread_local! {
    // The input thread owns the terminal; operation workers only send progress.
    static RENDERER: RefCell<Option<Renderer>> = const { RefCell::new(None) };
    static VIEW: RefCell<Option<View>> = const { RefCell::new(None) };
}

#[derive(Clone)]
struct View {
    title: String,
    body: Vec<(String, Role)>,
    offset: usize,
    celebration: Option<std::time::Duration>,
}

pub(crate) fn redraw() -> io::Result<()> {
    let view = VIEW.with(|view| view.borrow().clone());
    if let Some(view) = view {
        render_decorated(
            &view.title,
            &view.body,
            view.offset,
            &[Action::Quit],
            view.celebration,
        )?;
    }
    Ok(())
}

pub(crate) fn invalidate() {
    // Native SSH/sudo may have written anywhere. The next frame must repaint.
    RENDERER.with(|renderer| *renderer.borrow_mut() = None);
}

pub(crate) fn content_width(columns: u16) -> usize {
    usize::from(columns).saturating_sub(4).clamp(1, 100)
}

pub(crate) fn help_lines(help: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for action in help.split(" · ") {
        let action = action.replacen("Enter: ", "Enter ", 1);
        if !line.is_empty() && line.chars().count() + 3 + action.chars().count() > width {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push_str("   ");
        }
        line.push_str(&action);
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

fn shortcut_spans(text: &str, colour: bool) -> Vec<Span<'static>> {
    if text == "Press Ctrl-C again to quit" {
        return vec![Span::styled(text.to_owned(), style(Role::Action, colour))];
    }
    let mut spans = Vec::new();
    for (index, action) in text.split("   ").enumerate() {
        if index > 0 {
            spans.push(Span::raw("   "));
        }
        let (key, label) = action.split_once(' ').unwrap_or((action, ""));
        spans.push(Span::styled(key.to_owned(), style(Role::Action, colour)));
        if !label.is_empty() {
            spans.push(Span::raw(format!(" {label}")));
        }
    }
    spans
}

fn style(role: Role, colour: bool) -> Style {
    let base = Style::default();
    let emphasis = match role {
        Role::Heading
        | Role::Section
        | Role::Action
        | Role::Working
        | Role::Success
        | Role::SuccessTitle
        | Role::Warning => base.add_modifier(Modifier::BOLD),
        Role::Selected => base.add_modifier(Modifier::BOLD | Modifier::REVERSED),
        _ => base,
    };
    if !colour {
        return emphasis;
    }
    match role {
        Role::Heading | Role::Action | Role::Working => emphasis.fg(Color::LightBlue),
        Role::Selected => emphasis.fg(Color::LightBlue),
        Role::SelectedDetail => emphasis.fg(Color::Gray),
        Role::ListOption => emphasis,
        Role::ListDetail => emphasis.fg(Color::Gray),
        Role::Context | Role::Repository | Role::Pending => emphasis.fg(Color::Gray),
        Role::Warning => emphasis.fg(Color::LightYellow),
        Role::Success => emphasis.fg(Color::LightGreen),
        Role::SuccessTitle => emphasis.fg(Color::Black).bg(Color::LightBlue),
        Role::Commit => emphasis,
        Role::Progress => emphasis,
        Role::Body | Role::Section | Role::Field | Role::Input | Role::Shortcut => emphasis,
        Role::Placeholder => emphasis.fg(Color::DarkGray),
        Role::Hint => emphasis.fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
    }
}

fn version_style(colour: bool) -> Style {
    let style = Style::default().add_modifier(Modifier::ITALIC);
    if colour {
        style.fg(Color::DarkGray)
    } else {
        style
    }
}

fn body_lines(body: &[(String, Role)], width: usize, colour: bool) -> Vec<Line<'static>> {
    components::body_lines(body, width, colour)
}

pub(crate) fn spinner() -> &'static str {
    use std::time::Instant;
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    FRAMES[(START.get_or_init(Instant::now).elapsed().as_millis() / 80 % 10) as usize]
}

fn prose_lines(body: &[(String, Role)], width: usize, colour: bool) -> Vec<Line<'static>> {
    body.iter()
        .filter(|(_, role)| *role != Role::Repository)
        .flat_map(|(text, role)| {
            let lines = if matches!(role, Role::Input | Role::Placeholder) {
                let value = text.strip_prefix("> ").unwrap_or(text);
                let tail: String = value.chars().rev().take(width.saturating_sub(2)).collect();
                vec![tail.chars().rev().collect()]
            } else {
                crate::tui::wrap(std::slice::from_ref(text), width)
            };
            lines.into_iter().map(move |line| {
                if *role == Role::Working {
                    return Line::styled(
                        format!("{} {}", spinner(), line.trim_start_matches("› ")),
                        style(Role::Working, colour),
                    );
                }
                if *role == Role::Field
                    && let Some((label, value)) = line.split_once(": ")
                {
                    return components::Field { label, value }.line(colour);
                }
                if *role == Role::Shortcut {
                    return Line::from(shortcut_spans(&line, colour));
                }
                if matches!(role, Role::Input | Role::Placeholder) {
                    return components::Input {
                        value: &line,
                        placeholder: *role == Role::Placeholder,
                    }
                    .line(colour);
                }
                Line::styled(line, style(*role, colour))
            })
        })
        .collect()
}

fn footer_rows(footer: &[Action], width: usize) -> Vec<String> {
    let mut actions = footer
        .iter()
        .filter(|action| **action != Action::Help)
        .cloned()
        .collect::<Vec<_>>();
    if !actions.iter().any(|action| {
        matches!(
            action,
            Action::Quit | Action::Interrupt | Action::ConfirmQuit | Action::Stopping
        )
    }) {
        actions.push(Action::Quit);
    }
    if footer.contains(&Action::Help) {
        actions.push(Action::Help);
    }
    let labels = actions.iter().map(Action::label).collect::<Vec<_>>();
    let mut rows = help_lines(&labels.join(" · "), width);

    let version_width = format!("v{}", crate::VERSION).width();
    if rows
        .last()
        .is_none_or(|line| line.width() + 2 + version_width > width)
    {
        rows.push(String::new());
    }
    rows
}

fn chrome_height(width: u16, height: u16, footer: &[Action]) -> (u16, u16) {
    let header = 2;
    let footer = (footer_rows(footer, usize::from(width.saturating_sub(4))).len() as u16 + 1)
        .min(height.saturating_sub(5));
    (header, footer)
}

fn reserved_footer_height(width: u16, height: u16, footer: &[Action]) -> u16 {
    chrome_height(width, height, footer).1.max(
        chrome_height(
            width,
            height,
            &[
                Action::Primary("Select".into()),
                Action::Navigation,
                Action::Help,
                Action::Quit,
            ],
        )
        .1,
    )
}

fn selection_offset(width: u16, height: u16, body: &[(String, Role)], footer: &[Action]) -> usize {
    let header = 2;
    let footer = reserved_footer_height(width, height, footer);
    let room = usize::from(height.saturating_sub(header + footer + 2)).max(1);
    body_lines(body, usize::from(width.saturating_sub(4).min(76)), false)
        .iter()
        .position(|line| {
            line.spans
                .iter()
                .any(|span| span.style.add_modifier.contains(Modifier::REVERSED))
        })
        .map_or(0, |selected| selected.saturating_sub(room - 1))
}

pub(crate) fn render_selected(
    title: &str,
    body: &[(String, Role)],
    footer: &[Action],
) -> io::Result<usize> {
    let (width, height) = crossterm::terminal::size()?;
    render(
        title,
        body,
        selection_offset(width, height, body, footer),
        footer,
    )
}

/// Render into a supplied frame so previews and tests use the production layout.
pub(crate) fn render_frame(
    frame: &mut Frame<'_>,
    title: &str,
    body: &[(String, Role)],
    offset: usize,
    footer: &[Action],
    colour: bool,
    update: Option<&str>,
) -> usize {
    let confirmation = [Action::ConfirmQuit];
    let stopping = [Action::Stopping];
    let footer = if crate::quit::requested() {
        &stopping[..]
    } else if crate::quit::armed() && !footer.contains(&Action::Stopping) {
        &confirmation[..]
    } else {
        footer
    };
    let continuation = footer.iter().find_map(|action| match action {
        Action::Primary(label) if label == "Continue" => Some("Press Enter to continue"),
        Action::Primary(label) if label == "Done" => Some("Press Enter to finish"),
        _ => None,
    });
    let area = frame.area();
    if area.width < 40 || area.height < 12 {
        frame.render_widget(
            Paragraph::new("Enlarge terminal to 40 columns / 12 rows."),
            area,
        );
        return 0;
    }
    let title_height = if title.is_empty() { 0 } else { 2 };
    let hint_height = if continuation.is_some() { 2 } else { 0 };
    let content_room = area.height.saturating_sub(
        2 + reserved_footer_height(area.width, area.height, footer) + title_height + hint_height,
    );
    let line_count = body_lines(
        body,
        usize::from(area.width.saturating_sub(4).min(76)),
        colour,
    )
    .len();
    let choices = body
        .iter()
        .filter(|(_, role)| matches!(role, Role::Selected | Role::ListOption))
        .count();
    let actions: Vec<_> = footer
        .iter()
        .filter(|action| {
            !matches!(action, Action::Primary(label) if label == "Continue" || label == "Done")
                && (**action != Action::Navigation
                    || choices > 1
                    || line_count > usize::from(content_room))
        })
        .cloned()
        .collect();
    let footer = actions.as_slice();
    let area = Rect::new(area.x + 2, area.y, area.width - 4, area.height);
    let help = footer_rows(footer, usize::from(area.width));
    let (header_height, footer_height) = chrome_height(area.width + 4, area.height, footer);
    let [header, content, footer_area] = Layout::vertical([
        Constraint::Length(header_height),
        Constraint::Min(1),
        Constraint::Length(footer_height),
    ])
    .areas(area);
    let brand = match crate::operator_profile::name() {
        Some(name) => format!("[~] homelab ({name})"),
        None => "[~] homelab".into(),
    };
    let brand_width = brand.width();
    let mut brand_spans = vec![Span::styled("[~] homelab", style(Role::Heading, colour))];
    if let Some(name) = crate::operator_profile::name() {
        let profile_style = if colour {
            Style::default().fg(Color::DarkGray)
        } else {
            Style::default()
        };
        brand_spans.push(Span::styled(format!(" ({name})"), profile_style));
    }
    frame.render_widget(
        Paragraph::new(Line::from(brand_spans)).block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(style(Role::Pending, colour)),
        ),
        Rect::new(header.x, header.y, header.width, 2),
    );
    if let Some((repository, _)) = body.iter().find(|(_, role)| *role == Role::Repository)
        && let Some(link) = repository_link::layout(frame.area(), brand_width, repository)
    {
        frame.render_widget(
            Paragraph::new(link.label).style(
                (if colour {
                    Style::default().fg(Color::DarkGray)
                } else {
                    Style::default()
                })
                .add_modifier(Modifier::UNDERLINED),
            ),
            link.area,
        );
    }
    let reserved_footer = reserved_footer_height(area.width + 4, area.height, footer);
    let content = Rect {
        height: content
            .height
            .saturating_sub(reserved_footer.saturating_sub(footer_height)),
        ..content
    };
    let panel_width = content.width.min(76);
    let lines = body_lines(body, usize::from(panel_width), colour);
    let title_height = if title.is_empty() { 0 } else { 2 };
    // Routine progress and wrapped messages share an anchor instead of moving
    // the heading whenever one line appears or disappears.
    let hint_height = if continuation.is_some() { 2 } else { 0 };
    let panel_height = (lines.len() as u16 + title_height + hint_height)
        .max(12)
        .min(content.height);
    let panel = Rect::new(
        content.x + (content.width - panel_width) / 2,
        content.y + (content.height - panel_height) / 2,
        panel_width,
        panel_height,
    );
    if !title.is_empty() {
        frame.render_widget(
            Paragraph::new(title)
                .alignment(Alignment::Center)
                .style(style(Role::Section, colour)),
            Rect::new(panel.x, panel.y, panel.width, 1),
        );
    }
    let content = Rect::new(
        panel.x,
        panel.y + title_height,
        panel.width,
        panel.height.saturating_sub(title_height + hint_height),
    );
    let last = lines.len().saturating_sub(usize::from(content.height));
    let offset = offset.min(last);
    frame.render_widget(
        Paragraph::new(lines.into_iter().skip(offset.min(last)).collect::<Vec<_>>())
            .alignment(Alignment::Center),
        content,
    );
    if let Some(hint) = continuation {
        frame.render_widget(
            Paragraph::new(hint)
                .alignment(Alignment::Center)
                .style(style(Role::Hint, colour)),
            Rect::new(panel.x, panel.bottom().saturating_sub(1), panel.width, 1),
        );
    }
    let version = format!("v{}", crate::VERSION);
    let final_row = help.len().saturating_sub(1);
    let footer_lines = help
        .into_iter()
        .enumerate()
        .map(|(index, help)| {
            if index != final_row {
                return Line::from(shortcut_spans(&help, colour));
            }
            let update = update
                .map(|value| format!("Update {value} available · "))
                .unwrap_or_default();
            let status =
                if help.width() + 2 + update.width() + version.width() <= usize::from(area.width) {
                    format!("{update}{version}")
                } else {
                    version.clone()
                };
            let padding = usize::from(area.width).saturating_sub(help.width() + status.width());
            let mut spans = shortcut_spans(&help, colour);
            spans.push(Span::raw(" ".repeat(padding)));
            spans.push(Span::styled(status, version_style(colour)));
            Line::from(spans)
        })
        .collect::<Vec<_>>();
    frame.render_widget(
        Paragraph::new(footer_lines).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(style(Role::Pending, colour)),
        ),
        footer_area,
    );
    last
}

pub(crate) fn render(
    title: &str,
    body: &[(String, Role)],
    offset: usize,
    footer: &[Action],
) -> io::Result<usize> {
    render_decorated(title, body, offset, footer, None)
}

pub(crate) fn render_success(
    body: &[(String, Role)],
    elapsed: std::time::Duration,
    offset: usize,
) -> io::Result<usize> {
    render_decorated(
        "",
        body,
        offset,
        &[
            Action::Primary("Done".into()),
            Action::Navigation,
            Action::Quit,
        ],
        Some(elapsed),
    )
}

fn render_decorated(
    title: &str,
    body: &[(String, Role)],
    offset: usize,
    footer: &[Action],
    celebration: Option<std::time::Duration>,
) -> io::Result<usize> {
    VIEW.with(|view| {
        *view.borrow_mut() = Some(View {
            title: title.into(),
            body: body.to_vec(),
            offset,
            celebration,
        })
    });
    RENDERER.with(|renderer| {
        let mut renderer = renderer.borrow_mut();
        if renderer.is_none() {
            let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
            terminal.clear()?;
            *renderer = Some(terminal);
        }
        let mut link = None;
        let mut commit_links = Vec::new();
        let mut last = 0;
        renderer
            .as_mut()
            .expect("renderer initialized")
            .draw(|frame| {
                static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
                let elapsed = celebration
                    .unwrap_or_else(|| START.get_or_init(std::time::Instant::now).elapsed());
                let area = frame.area();
                let width = area.width.saturating_sub(4).min(76);
                let lines = body_lines(body, usize::from(width.max(1)), false).len() as u16;
                let height = (lines + if title.is_empty() { 0 } else { 2 } + 4)
                    .max(16)
                    .min(area.height.saturating_sub(4));
                let panel = Rect::new(
                    area.x + area.width.saturating_sub(80) / 2,
                    area.y + area.height.saturating_sub(height) / 2,
                    area.width.min(80),
                    height,
                );
                celebration::render(
                    frame,
                    elapsed,
                    std::env::var_os("NO_COLOR").is_none(),
                    panel,
                );
                let brand_width = match crate::operator_profile::name() {
                    Some(name) => format!("[~] homelab ({name})").width(),
                    None => "[~] homelab".width(),
                };
                link = body
                    .iter()
                    .find(|(_, role)| *role == Role::Repository)
                    .and_then(|(label, _)| {
                        repository_link::layout(frame.area(), brand_width, label)
                    });
                last = render_frame(
                    frame,
                    title,
                    body,
                    offset,
                    footer,
                    std::env::var_os("NO_COLOR").is_none(),
                    None,
                );
                commit_links = body
                    .iter()
                    .filter(|(_, role)| *role == Role::Commit)
                    .filter_map(|(reference, _)| repository_link::commit(frame, reference))
                    .collect();
            })?;
        if let Some(link) = link {
            repository_link::attach(&link, std::env::var_os("NO_COLOR").is_none())?;
        }
        for link in commit_links {
            repository_link::attach(&link, std::env::var_os("NO_COLOR").is_none())?;
        }
        Ok(last)
    })
}

pub(crate) fn help_body() -> Vec<(String, Role)> {
    vec![
        ("Navigation".into(), Role::Section),
        (String::new(), Role::Body),
        ("↑/↓ Navigation".into(), Role::Shortcut),
        ("Enter Select".into(), Role::Shortcut),
        ("i Mac details".into(), Role::Shortcut),
        ("Esc Back".into(), Role::Shortcut),
        ("Ctrl-C Quit (press twice)".into(), Role::Shortcut),
        (String::new(), Role::Body),
        (String::new(), Role::Body),
        ("During setup".into(), Role::Section),
        (String::new(), Role::Body),
        ("? Step help".into(), Role::Shortcut),
        ("Esc Stop after current step".into(), Role::Shortcut),
        (String::new(), Role::Body),
        (String::new(), Role::Body),
        ("Documentation and source".into(), Role::Section),
        (String::new(), Role::Body),
        (
            "https://github.com/0x63616c/world-wide-webb/tree/main/homelab/cli".into(),
            Role::Context,
        ),
    ]
}

pub(crate) fn help() -> io::Result<()> {
    use crossterm::event::KeyCode;
    let body = help_body();
    let mut offset = 0;
    loop {
        let last = render("Help", &body, offset, &[Action::Navigation, Action::Back])?;
        match crate::setup_wizard::key()? {
            code if Action::Back.matches(code) || Action::Help.matches(code) => return Ok(()),
            KeyCode::Up => offset = offset.saturating_sub(1),
            KeyCode::Down => offset = (offset + 1).min(last),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;

    #[test]
    fn compact_lists_keep_original_selection_and_mark_other_options() {
        let body = vec![
            ("> First".into(), Role::Selected),
            ("  Second".into(), Role::ListOption),
        ];
        let lines = body_lines(&body, 76, true);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].to_string().trim_start(), "> First");
        assert!(
            !lines[0].spans[1]
                .style
                .add_modifier
                .contains(Modifier::REVERSED)
        );
        assert!(
            lines[0].spans[2]
                .style
                .add_modifier
                .contains(Modifier::REVERSED)
        );
        assert_eq!(lines[1].to_string().trim_start(), "○ Second");
        assert_eq!(lines[1].style.bg, None);
    }

    #[test]
    fn quit_confirmation_is_one_blue_action() {
        let spans = shortcut_spans("Press Ctrl-C again to quit", true);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].style.fg, Some(Color::LightBlue));
    }

    #[test]
    fn every_loading_surface_disables_stop_after_confirmed_request() {
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        for (width, height) in [(40, 12), (80, 24)] {
            crate::quit::reset();
            let key = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
            crate::quit::handle(key);
            crate::quit::handle(key);
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal
                .draw(|frame| {
                    render_frame(
                        frame,
                        "Connecting to your Mac",
                        &[("Waiting for 1Password".into(), Role::Working)],
                        0,
                        &[Action::StopAfterStep, Action::Quit],
                        false,
                        None,
                    );
                })
                .unwrap();
            let text: String = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|cell| cell.symbol())
                .collect();
            crate::quit::reset();
            assert!(text.contains("Stopping…"), "{text}");
            assert!(
                !text.contains("Stop after") && !text.contains("Ctrl-C Quit"),
                "{text}"
            );
        }
    }

    #[test]
    fn stopping_is_status_without_an_added_quit_shortcut() {
        let footer = footer_rows(&[Action::Stopping, Action::Help], 80).join("\n");
        assert!(footer.contains("Stopping…"));
        assert!(!footer.contains("Quit") && !footer.contains("Stop after"));
    }

    #[test]
    fn help_is_the_last_footer_action() {
        for width in [36, 76, 156] {
            let rows = footer_rows(
                &[Action::Primary("Select".into()), Action::Help, Action::Back],
                width,
            );
            assert!(rows.join(" ").trim_end().ends_with("? Help"));
        }
    }

    #[test]
    fn host_metadata_never_inherits_selection_emphasis() {
        let lines = body_lines(
            &[(
                "> lab-mac · Checking…  admin@lab-mac.local".into(),
                Role::Selected,
            )],
            76,
            true,
        );
        let name = &lines[0].spans[2];
        let metadata = &lines[0].spans[3];
        assert_eq!(name.content, "lab-mac");
        assert!(name.style.add_modifier.contains(Modifier::REVERSED));
        assert!(metadata.style.sub_modifier.contains(Modifier::REVERSED));
        assert_eq!(metadata.style.fg, Some(Color::DarkGray));
    }

    #[test]
    fn loading_and_hosts_keep_the_heading_in_the_same_centered_panel() {
        let title = "Which Mac do you want to set up?";
        for (width, height) in [(40, 12), (80, 24), (160, 48)] {
            let mut positions = Vec::new();
            for body in [
                vec![("Reading configuration".into(), Role::Working)],
                vec![
                    (String::new(), Role::Body),
                    ("> lab-mac · Not set up".into(), Role::Selected),
                    ("  other-mac · Not set up".into(), Role::ListOption),
                ],
            ] {
                let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
                let footer: &[Action] = if positions.is_empty() {
                    &[Action::Quit]
                } else {
                    &[
                        Action::Primary("Select".into()),
                        Action::Navigation,
                        Action::Help,
                        Action::Quit,
                    ]
                };
                terminal
                    .draw(|frame| {
                        render_frame(frame, title, &body, 0, footer, true, None);
                    })
                    .unwrap();
                let buffer = terminal.backend().buffer();
                let y = (0..height)
                    .find(|y| {
                        (0..width)
                            .map(|x| buffer[(x, *y)].symbol())
                            .collect::<String>()
                            .contains(title)
                    })
                    .unwrap();
                let x = (0..width)
                    .find(|x| buffer[(*x, y)].symbol() == "W")
                    .unwrap();
                positions.push((x, y));
                assert_eq!(x, (width - title.width() as u16) / 2);
                assert!(y >= 2);
                assert_eq!(buffer[(2, 0)].symbol(), "[");
            }
            assert_eq!(positions[0], positions[1]);
        }
    }

    fn screen(width: u16, height: u16, offset: usize) -> (String, usize) {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        let body = (0..30)
            .map(|n| (format!("Step {n}"), Role::Body))
            .collect::<Vec<_>>();
        let mut last = 0;
        terminal
            .draw(|frame| {
                last = render_frame(
                    frame,
                    "Your Macs",
                    &body,
                    offset,
                    &[
                        Action::Navigation,
                        Action::Primary("Select".into()),
                        Action::Help,
                    ],
                    false,
                    None,
                );
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let text = (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        (text, last)
    }

    #[test]
    fn shared_frame_keeps_header_footer_and_scroll_visible() {
        for (width, height) in [(40, 12), (80, 24), (140, 40)] {
            let (text, last) = screen(width, height, usize::MAX);
            assert!(text.contains("[~] homelab"));
            assert!(text.contains("Your Macs"));
            assert!(text.contains("Step 29"));
            assert!(text.contains("Enter Select"));
            assert!(text.contains(crate::VERSION));
            assert!(last <= 30);
        }
    }

    #[test]
    fn wide_footer_shares_one_row_with_right_aligned_version() {
        let (text, _) = screen(140, 24, 0);
        let rows = text.lines().collect::<Vec<_>>();
        let footer = rows.last().unwrap();
        assert!(footer.contains("Enter Select"));
        assert!(footer.trim_end().ends_with(&format!("v{}", crate::VERSION)));
        assert_eq!(footer.len() - footer.trim_end().len(), 2);
    }

    #[test]
    fn tiny_terminal_is_safe() {
        let (text, last) = screen(20, 5, 0);
        assert!(text.contains("Enlarge terminal"));
        assert_eq!(last, 0);
    }

    #[test]
    fn monochrome_selection_stays_distinct() {
        assert!(
            style(Role::Selected, false)
                .add_modifier
                .contains(Modifier::REVERSED)
        );
    }

    #[test]
    fn selected_choice_remains_visible_at_minimum_size() {
        let mut terminal = Terminal::new(TestBackend::new(40, 12)).unwrap();
        let mut body = (0..20)
            .map(|n| (format!("Choice {n}"), Role::Body))
            .collect::<Vec<_>>();
        body.push(("> Final choice".into(), Role::Selected));
        let footer = &[
            Action::Navigation,
            Action::Primary("Select".into()),
            Action::Back,
        ];
        let offset = selection_offset(40, 12, &body, footer);
        terminal
            .draw(|frame| {
                render_frame(frame, "Choose", &body, offset, footer, false, None);
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        assert!(
            buffer
                .content()
                .iter()
                .any(|cell| cell.modifier.contains(Modifier::REVERSED))
        );
    }

    #[test]
    fn explicit_scroll_can_reach_top_even_with_a_selected_step() {
        let mut terminal = Terminal::new(TestBackend::new(40, 18)).unwrap();
        let mut body = vec![("FIRST STEP".into(), Role::Body)];
        body.extend((0..20).map(|n| (format!("Step {n}"), Role::Body)));
        body.push(("> Current step".into(), Role::Selected));
        terminal
            .draw(|frame| {
                render_frame(
                    frame,
                    "Setup",
                    &body,
                    0,
                    &[Action::Navigation, Action::Help],
                    false,
                    None,
                );
            })
            .unwrap();
        let text = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(text.contains("FIRST STEP"));
        assert!(!text.contains("Current step"));
    }

    #[test]
    fn scrolling_reaches_final_approval_text_without_footer_reflow() {
        let mut terminal = Terminal::new(TestBackend::new(40, 12)).unwrap();
        let mut body = (0..20)
            .map(|n| (format!("Review line {n}"), Role::Body))
            .collect::<Vec<_>>();
        body.push(("FINAL REVIEW LINE".into(), Role::Warning));
        let footer = &[
            Action::Primary("Begin setup".into()),
            Action::Navigation,
            Action::Help,
            Action::Back,
        ];
        let mut last = 0;
        terminal
            .draw(|frame| last = render_frame(frame, "Review", &body, 0, footer, false, None))
            .unwrap();
        assert!(last > 0);
        let original_last = last;
        terminal
            .draw(|frame| last = render_frame(frame, "Review", &body, last, footer, false, None))
            .unwrap();
        assert_eq!(last, original_last);
        let buffer = terminal.backend().buffer();
        let text = buffer
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(text.contains("FINAL REVIEW LINE"));
    }
}

#[cfg(test)]
mod polish_tests {
    use super::*;
    use ratatui::backend::TestBackend;

    fn text(terminal: &Terminal<TestBackend>, row: u16) -> String {
        let buffer = terminal.backend().buffer();
        (0..buffer.area.width)
            .map(|column| buffer[(column, row)].symbol())
            .collect()
    }

    #[test]
    fn help_only_advertises_navigation_when_content_overflows() {
        for (width, height, scrolls) in [(100, 50, false), (40, 12, true)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            let mut last = 0;
            terminal
                .draw(|frame| {
                    last = render_frame(
                        frame,
                        "Help",
                        &help_body(),
                        0,
                        &[Action::Navigation, Action::Back],
                        true,
                        None,
                    );
                })
                .unwrap();
            assert_eq!(last > 0, scrolls);
            let footer = (height - 3..height)
                .map(|row| text(&terminal, row))
                .collect::<String>();
            assert_eq!(footer.contains("↑/↓ Navigation"), scrolls);
            assert!(footer.contains("Esc Back"));
            assert!(footer.contains("Ctrl-C Quit"));
        }
    }

    #[test]
    fn detail_fields_are_normal_text_and_repository_is_underlined_without_a_prefix() {
        let field = components::Field {
            label: "SSH",
            value: "admin@lab-mac.local",
        }
        .line(true);
        assert_eq!(field.spans[0].style.fg, Some(Color::Gray));
        for span in &field.spans {
            assert!(
                !span
                    .style
                    .add_modifier
                    .intersects(Modifier::BOLD | Modifier::ITALIC)
            );
            assert_ne!(span.style.fg, Some(Color::LightBlue));
        }
        let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
        terminal
            .draw(|frame| {
                render_frame(
                    frame,
                    "About lab-mac",
                    &[("Repo: example/config".into(), Role::Repository)],
                    0,
                    &[Action::Back],
                    true,
                    None,
                );
            })
            .unwrap();
        let header = text(&terminal, 0);
        assert!(!header.contains("Repo:"));
        let start = header.find("example/config").unwrap() as u16;
        for column in start..start + 14 {
            let cell = &terminal.backend().buffer()[(column, 0)];
            assert_eq!(cell.fg, Color::DarkGray);
            assert!(cell.modifier.contains(Modifier::UNDERLINED));
        }
    }

    #[test]
    fn progress_updates_keep_heading_and_footer_positions_stable() {
        for (width, height) in [(80, 24), (160, 48)] {
            let mut positions = Vec::new();
            for message in [
                "Installing",
                "Installing developer tools. Downloads may take several minutes; leave this Mac connected.",
            ] {
                let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
                terminal
                    .draw(|frame| {
                        render_frame(
                            frame,
                            "Setting up your Mac",
                            &[
                                ("lab-mac".into(), Role::Context),
                                (String::new(), Role::Body),
                                (message.into(), Role::Working),
                            ],
                            0,
                            &[Action::Quit],
                            true,
                            None,
                        );
                    })
                    .unwrap();
                positions.push(
                    (0..height)
                        .find(|row| text(&terminal, *row).contains("Setting up your Mac"))
                        .unwrap(),
                );
                assert!(text(&terminal, height - 1).contains("Ctrl-C Quit"));
            }
            assert_eq!(positions[0], positions[1]);
        }
    }
}
