/** @jsxImportSource @opentui/solid */
// @ts-nocheck OpenCode supplies the TUI JSX runtime when it loads TUI plugins.

function SmokeSidebar() {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text bold>Plugin lab</text>
      <text fg="gray">Smoke sidebar loaded</text>
    </box>
  );
}

function tui(api) {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content() {
        return <SmokeSidebar />;
      },
    },
  });
}

export default { id: "smoke-sidebar", tui };
