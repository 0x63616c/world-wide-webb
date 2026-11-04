import SwiftUI

private enum SettingsLayout {
    static let inset: CGFloat = 16
    static let rowHeight: CGFloat = 54
}

struct SettingsSection<Content: View>: View {
    let title: String
    let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            content.modifier(SettingsSurface())
        }
    }
}

struct SettingsSurface: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity, alignment: .leading)
            .background(.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
    }
}

struct SettingsRow<Content: View>: View {
    var minHeight: CGFloat
    let content: Content
    init(minHeight: CGFloat = 54, @ViewBuilder content: () -> Content) {
        self.minHeight = minHeight; self.content = content()
    }
    var body: some View {
        HStack(spacing: 12) { content }
            .frame(minHeight: minHeight).padding(.horizontal, SettingsLayout.inset)
    }
}

struct SettingsDivider: View {
    var body: some View { Divider().padding(.horizontal, SettingsLayout.inset) }
}

struct SettingsRowIcon: View {
    let symbol: String
    init(_ symbol: String) { self.symbol = symbol }
    var body: some View {
        Image(systemName: symbol).font(.system(size: 16)).foregroundStyle(.secondary).frame(width: 24)
    }
}

struct SettingsSwitch: View {
    let title: String
    @Binding var isOn: Bool
    init(_ title: String, isOn: Binding<Bool>) { self.title = title; _isOn = isOn }
    var body: some View {
        Toggle(title, isOn: $isOn).labelsHidden().toggleStyle(.switch)
    }
}

struct SettingsSwitchRow: View {
    let title: String
    @Binding var isOn: Bool
    init(_ title: String, isOn: Binding<Bool>) { self.title = title; _isOn = isOn }
    var body: some View {
        SettingsRow(minHeight: SettingsLayout.rowHeight) {
            Text(title)
            Spacer()
            SettingsSwitch(title, isOn: $isOn)
        }
    }
}

struct SettingsHoverAction: View {
    let title: String
    let symbol: String
    let hovering: Bool
    let action: () -> Void
    @FocusState private var focused: Bool
    @AccessibilityFocusState private var accessibilityFocused: Bool
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).frame(width: 24, height: 24)
        }
        .buttonStyle(.borderless).foregroundStyle(.secondary)
        .help(title).accessibilityLabel(title)
        .focused($focused).accessibilityFocused($accessibilityFocused)
        .opacity(hovering || focused || accessibilityFocused ? 1 : 0)
        .accessibilityHidden(false)
    }
}
