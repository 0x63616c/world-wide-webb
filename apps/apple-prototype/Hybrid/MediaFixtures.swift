#if DEBUG
import Foundation
import PanelKit

/// An explicit, synthetic capability injection. This is not a backend response.
/// The owned loopback fixture server must be started for video playback checks.
struct HybridMediaFixture: MediaServing {
    let unavailable: Bool
    func videos() async throws -> [PanelMediaVideo] {
        if unavailable { throw MediaError.sourceUnavailable }
        return [.init(id: "synthetic_video", title: "Synthetic playback check", subtitle: "8-second test pattern",
                      url: URL(string: "http://localhost:18733/synthetic.mp4")!)]
    }
}
#endif
