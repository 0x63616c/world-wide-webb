const { copyFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { withInfoPlist, withXcodeProject } = require("expo/config-plugins");

const EXTENSION = "NextAlarmWidget";

/** All native project edits are reproducible on a clean Expo prebuild.
 * @type {import("expo/config-plugins").ConfigPlugin}
 */
const withPanelAlarms = (config) => {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const root = mod.modRequest.projectRoot;
    const ios = mod.modRequest.platformProjectRoot;
    const intents = "PanelAlarmIntents";
    mkdirSync(join(ios, intents), { recursive: true });
    mkdirSync(join(ios, EXTENSION), { recursive: true });
    copyFileSync(
      join(root, "native/alarms/CreatePanelAlarmIntent.swift"),
      join(ios, intents, "CreatePanelAlarmIntent.swift"),
    );
    copyFileSync(
      join(root, "native/alarms/NextAlarmWidget.swift"),
      join(ios, EXTENSION, "NextAlarmWidget.swift"),
    );
    copyFileSync(
      join(root, "modules/panel-alarms/ios/NextAlarmAttributes.swift"),
      join(ios, EXTENSION, "NextAlarmAttributes.swift"),
    );
    writeFileSync(
      join(ios, EXTENSION, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Next Alarm</string>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>
</dict></plist>`,
    );

    const main = project.getFirstTarget();
    const source = `${intents}/CreatePanelAlarmIntent.swift`;
    if (!project.hasFile(source)) {
      const group = project.addPbxGroup([], intents);
      project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
      project.addSourceFile(source, { target: main.uuid }, group.uuid);
    }
    const targets = project.pbxNativeTargetSection();
    const existing = Object.entries(targets).find(
      ([, target]) =>
        target &&
        typeof target === "object" &&
        "name" in target &&
        String(target.name).replaceAll('"', "") === EXTENSION,
    );
    // node-xcode silently skips dependencies if a clean template has neither
    // section yet. Embedding the product alone does not guarantee it builds.
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const bundleId = `${config.ios?.bundleIdentifier}.${EXTENSION}`;
    const target = existing
      ? { uuid: existing[0] }
      : project.addTarget(EXTENSION, "app_extension", EXTENSION, bundleId);
    if (!existing) {
      project.addBuildPhase(
        [`${EXTENSION}/NextAlarmWidget.swift`, `${EXTENSION}/NextAlarmAttributes.swift`],
        "PBXSourcesBuildPhase",
        "Sources",
        target.uuid,
      );
      project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
      project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    }
    if (
      !main.firstTarget.dependencies.some(
        (dependency) => objects.PBXTargetDependency[dependency.value]?.target === target.uuid,
      )
    ) {
      project.addTargetDependency(main.uuid, [target.uuid]);
    }
    const configs = project.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configs)) {
      if (typeof entry !== "object" || entry.buildSettings?.PRODUCT_NAME !== `"${EXTENSION}"`)
        continue;
      Object.assign(entry.buildSettings, {
        INFOPLIST_FILE: `"${EXTENSION}/Info.plist"`,
        SWIFT_VERSION: "5.0",
        IPHONEOS_DEPLOYMENT_TARGET: "16.2",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CODE_SIGN_STYLE: "Automatic",
        MARKETING_VERSION: config.version ?? "1.0",
        CURRENT_PROJECT_VERSION: config.ios?.buildNumber ?? "1",
        VERSIONING_SYSTEM: "apple-generic",
        GENERATE_INFOPLIST_FILE: "NO",
      });
    }
    return mod;
  });
};

module.exports = { withPanelAlarms };
