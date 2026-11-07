import SwiftUI

#if !DEBUG
  #error(
    "Production composition and release gates are not implemented yet. Do not archive the build harness."
  )
#endif

/// Temporary native launch harness for the build foundation. Replace with the reviewed app composition.
@main struct FoldingApp: App {
  var body: some Scene {
    WindowGroup {
      NavigationStack {
        ContentUnavailableView(
          "Folding", systemImage: "iphone", description: Text("Development build")
        )
        .navigationTitle("Folding")
      }
    }
  }
}
