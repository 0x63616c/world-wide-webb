import SwiftUI

struct RemindersModule: View {
    let provider: LiveRemindersProvider
    @State private var title = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Reminders").font(.largeTitle)
            HStack {
                TextField("New reminder", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("New reminder")
                Button("Add") {
                    let draft = title
                    Task {
                        await provider.add(title: draft)
                        if provider.availability == .live { title = "" }
                    }
                }.disabled(provider.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if provider.items.isEmpty {
                ContentUnavailableView("No reminders", systemImage: "checklist", description: Text("Your incomplete reminders appear here."))
            } else {
                List(provider.items) { item in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(item.title)
                            Text(item.list).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Complete") { Task { await provider.complete(id: item.id) } }
                            .disabled(provider.busy || !item.writable)
                            .accessibilityLabel("Complete \(item.title)")
                    }
                }
            }
        }.padding(32)
    }
}
