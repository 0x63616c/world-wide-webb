import SwiftUI

struct PhotoRotation: View {
    let provider: any PhotosProvider
    let now: Date
    var fullScreen: Bool
    @Environment(\.motionPhase) private var phase
    @State private var index = 1
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottomLeading) {
                ForEach(provider.photos) { photo in
                    Image(photo.asset).resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height).clipped()
                        .opacity(provider.photos[index].id == photo.id ? 1 : 0)
                        .accessibilityHidden(true)
                }
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
                if fullScreen {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(fixtureTime(now, format: "h:mm")).font(.system(size: 64, weight: .light)).monospacedDigit()
                        Text(fixtureTime(now, format: "EEEE, MMMM d")).font(.system(size: 22, weight: .medium))
                    }.padding(48)
                    Text("Fixture photos · \(provider.photos[index].credit)")
                        .font(.system(size: 12)).frame(
                            maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing
                        ).padding(32)
                } else {
                    HStack {
                        Label("Photos", systemImage: "photo.on.rectangle.angled").font(
                            .system(size: 22, weight: .semibold))
                        Spacer()
                        Text("\(provider.photos.count) photos").font(.system(size: 15))
                    }.padding(28)
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }.task(id: phase) {
            guard phase == nil else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                withAnimation(.easeInOut(duration: 1.2)) { index = (index + 1) % provider.photos.count }
            }
        }
    }
}
