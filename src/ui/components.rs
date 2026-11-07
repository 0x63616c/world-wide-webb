//! Shared visual components; callers provide state instead of terminal escape codes.
use super::{Role, prose_lines, style};
use ratatui::layout::Alignment;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

pub(super) fn body_lines(
    body: &[(String, Role)],
    width: usize,
    colour: bool,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut list_indices = Vec::new();
    for (text, role) in body {
        if matches!(*role, Role::Repository | Role::Commit) {
            continue;
        }
        let item = matches!(role, Role::Selected | Role::ListOption);
        let detail = matches!(role, Role::ListDetail | Role::SelectedDetail);
        if item || detail {
            let selected = matches!(role, Role::Selected | Role::SelectedDetail);
            let base = style(*role, colour);
            let value = text
                .trim_start()
                .strip_prefix("> ")
                .unwrap_or(text.trim_start());
            let mut name_remaining = value
                .split_once(" · ")
                .map(|(name, _)| name.chars().count());
            let wrapped = crate::tui::wrap(&[value.to_owned()], width.saturating_sub(2).max(1));
            for (index, value) in wrapped.into_iter().enumerate() {
                let marker = if detail || index > 0 {
                    "  "
                } else if selected {
                    "> "
                } else {
                    "○ "
                };
                let mut spans = vec![Span::styled(
                    marker,
                    if colour && !selected {
                        base.fg(Color::DarkGray)
                    } else {
                        base.remove_modifier(Modifier::REVERSED | Modifier::BOLD)
                    },
                )];
                if let Some(remaining) = &mut name_remaining {
                    let split = value
                        .char_indices()
                        .nth(*remaining)
                        .map_or(value.len(), |(index, _)| index);
                    spans.push(Span::styled(value[..split].to_owned(), base));
                    spans.push(Span::styled(
                        value[split..].replacen(" · ", "  ", 1),
                        if colour {
                            Style::default()
                                .fg(Color::DarkGray)
                                .remove_modifier(Modifier::REVERSED | Modifier::BOLD)
                        } else {
                            Style::default().remove_modifier(Modifier::REVERSED | Modifier::BOLD)
                        },
                    ));
                    *remaining = remaining.saturating_sub(value.chars().count());
                } else {
                    spans.push(Span::styled(
                        value.clone(),
                        if detail && colour {
                            base.fg(Color::Gray).remove_modifier(Modifier::BOLD)
                        } else {
                            base
                        },
                    ));
                }
                list_indices.push(lines.len());
                lines.push(Line::from(spans));
            }
        } else {
            lines.extend(prose_lines(
                &[(text.clone(), *role)],
                width.min(100),
                colour,
            ));
        }
    }
    let list_width = list_indices
        .iter()
        .map(|index| lines[*index].width())
        .max()
        .unwrap_or(0);
    let padding = width.saturating_sub(list_width) / 2;
    for index in list_indices {
        lines[index].spans.insert(
            0,
            Span::styled(
                " ".repeat(padding),
                Style::default().remove_modifier(Modifier::REVERSED | Modifier::BOLD),
            ),
        );
        lines[index].alignment = Some(Alignment::Left);
    }
    lines
}

pub(super) struct Field<'a> {
    pub label: &'a str,
    pub value: &'a str,
}
impl Field<'_> {
    pub(super) fn line(&self, colour: bool) -> Line<'static> {
        Line::from(vec![
            Span::styled(format!("{}: ", self.label), style(Role::Context, colour)),
            Span::styled(self.value.to_owned(), style(Role::Body, colour)),
        ])
    }
}

pub(super) struct Input<'a> {
    pub value: &'a str,
    pub placeholder: bool,
}
impl Input<'_> {
    pub(super) fn line(&self, colour: bool) -> Line<'static> {
        Line::from(vec![
            Span::styled("> ", style(Role::Action, colour)),
            Span::styled(
                self.value.to_owned(),
                style(
                    if self.placeholder {
                        Role::Placeholder
                    } else {
                        Role::Input
                    },
                    colour,
                ),
            ),
        ])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProgressState {
    Pending,
    Running,
    Complete,
    Failed,
}
impl ProgressState {
    pub(crate) fn row(self, label: &str) -> (String, Role) {
        let (symbol, role) = match self {
            Self::Pending => ("○", Role::Pending),
            Self::Running => ("›", Role::Working),
            Self::Complete => ("✓", Role::Success),
            Self::Failed => ("!", Role::Warning),
        };
        (format!("{symbol} {label}"), role)
    }
}

/// Authentication owns a fixed form; native retry history is never part of it.
pub(crate) fn password_field(
    host: &str,
    label: &str,
    masked_length: usize,
    rejected: bool,
) -> Vec<(String, Role)> {
    vec![
        (host.into(), Role::Context),
        (String::new(), Role::Body),
        (label.into(), Role::Section),
        (
            format!("> {}", "*".repeat(masked_length.min(48))),
            Role::Input,
        ),
        (String::new(), Role::Body),
        if rejected {
            ("Password not accepted. Try again.".into(), Role::Warning)
        } else {
            (String::new(), Role::Body)
        },
    ]
}
