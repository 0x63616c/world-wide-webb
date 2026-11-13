//! Keep loading feedback responsive while bounded operations run off the UI thread.
use crossterm::event::{self, Event};
use std::io;
use std::time::Duration;

pub(crate) fn run<T: Send>(
    mut draw: impl FnMut() -> io::Result<()>,
    operation: impl FnOnce() -> T + Send,
) -> io::Result<T> {
    std::thread::scope(|scope| {
        let worker = scope.spawn(operation);
        let display: io::Result<()> = (|| {
            loop {
                draw()?;
                if worker.is_finished() {
                    return Ok(());
                }
                if event::poll(Duration::from_millis(80))?
                    && let Event::Key(key) = event::read()?
                {
                    crate::quit::handle(key);
                }
            }
        })();
        // A closed terminal must not detach work or allow a second attempt to race it.
        let result = worker
            .join()
            .map_err(|_| io::Error::other("Loading stopped; saved progress is preserved."))?;
        display?;
        Ok(result)
    })
}
