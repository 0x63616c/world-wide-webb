/** @jsxImportSource @opentui/solid */
// @ts-nocheck OpenCode supplies the TUI JSX runtime when it loads TUI plugins.

function SmokeSidebar() {
  return (
    <box flexDirection="column" padding={1} borderStyle="round" borderColor="blue">
      <text fg="blue">Plugin lab</text>
      <text>Smoke sidebar loaded</text>
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
