# Shortcuts setup evidence

November 7, 2026. Isolated simulator Folding Shortcuts QA,
EF046480-69D4-4802-BF6B-983E67E1C942, iPhone Duo, iOS 27.2 build24B91016s.

The installed Folding action appeared in Shortcuts search as **Record Opening**
and was added to a new shortcut. The editor's action browser exposes **Automation**.
Its list was scrolled from Daily Routine through Environment; no Display section
or fold-specific trigger appeared. Searching **Open or Closed** returned an empty
list (`build/ui-review/shortcuts/fold-trigger-empty.png`). Initial simulator boot
reported a data migration failure before Shortcuts launched, so this is a simulator
limitation observation, not proof that physical Duo lacks the trigger.

Apple's current [automation guide](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios)
uses the editor to add automation and documents the privacy setting for locked
execution. Its trigger list does not document Duo opening/closing. Exact fold
trigger names and localized OS labels therefore remain unverified here.

The implementation supplies generic manual guidance using Folding's own localized
action titles, plus optional composition-supplied verified trigger instructions.
It does not invent an exact trigger label or a deep link into an automation page.
Users explicitly confirm configuration before beginning the existing durable
receipt test. Opening Shortcuts or confirming configuration never completes setup.
Rerunning setup directs people to edit existing shortcuts rather than duplicate
them. Locked execution and actual fold delivery remain physical-device checks.

At the owner's implementation-first direction, further simulator investigation,
render matrices, and new test expansion are deferred to the final review pass.
