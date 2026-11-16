import SwiftUI

/// The same state face is used by app destinations and the native module branch.
struct ModuleStatusFace: View {
    let title: String
    let status: HomeModuleStatus
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if status == .loading {
                ProgressView().frame(height: 48).accessibilityLabel("Loading \(title)")
            } else {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 28, weight: .medium)).foregroundStyle(.secondary)
                    .frame(height: 48)
            }
            Spacer(minLength: 16)
            Text(title).font(.system(size: 22, weight: .semibold))
            Text(status.reason ?? "").font(.system(size: 17)).foregroundStyle(.secondary)
                .accessibilityIdentifier("module-status-reason")
                .lineLimit(3).padding(.top, 5)
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}
