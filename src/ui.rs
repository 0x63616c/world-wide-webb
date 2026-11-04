//! Shared terminal presentation; roles stay readable without colour.
use std::io::{self, Write};

use crossterm::queue;
use crossterm::style::{Attribute, Color, ResetColor, SetAttribute, SetForegroundColor};

#[derive(Clone, Copy)]
pub(crate) enum Role {
    Heading,
    Context,
    Body,
    Section,
    Selected,
    Action,
    Help,
    Warning,
}

pub(crate) fn content_width(columns: u16) -> usize {
    usize::from(columns).saturating_sub(4).clamp(1, 76)
}

pub(crate) fn paint(output: &mut impl Write, text: &str, role: Role) -> io::Result<()> {
    let colour = std::env::var_os("NO_COLOR").is_none();
    if colour {
        let (foreground, attribute) = match role {
            Role::Heading | Role::Action => (Color::Cyan, Attribute::Bold),
            Role::Selected => (Color::Cyan, Attribute::Reverse),
            Role::Section => (Color::White, Attribute::Bold),
            Role::Context | Role::Help => (Color::Grey, Attribute::NormalIntensity),
            Role::Warning => (Color::Yellow, Attribute::Bold),
            Role::Body => (Color::Reset, Attribute::NormalIntensity),
        };
        queue!(
            output,
            SetForegroundColor(foreground),
            SetAttribute(attribute)
        )?;
    }
    write!(output, "{text}")?;
    if colour {
        queue!(output, ResetColor, SetAttribute(Attribute::Reset))?;
    }
    Ok(())
}

pub(crate) fn paint_fact(output: &mut impl Write, text: &str) -> io::Result<()> {
    if let Some((label, value)) = text.split_once(": ")
        && label.len() <= 32
    {
        paint(output, &format!("{label}: "), Role::Section)?;
        paint(output, value, Role::Body)
    } else {
        paint(output, text, Role::Body)
    }
}
