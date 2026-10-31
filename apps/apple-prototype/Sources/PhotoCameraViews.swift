import SwiftUI

struct PhotoRotation: View {
    let provider: any PhotosProvider
    let now: Date
    var fullScreen: Bool
    @Environment(\.motionPhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
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
                        .font(.system(size: 12)).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing).padding(32)
                } else {
                    HStack {
                        Label("Photos", systemImage: "photo.on.rectangle.angled").font(.system(size: sizeClass == .compact ? 22 : 28, weight: .semibold))
                        Spacer()
                        Text("\(provider.photos.count) photos").font(.system(size: sizeClass == .compact ? 15 : 20))
                    }.padding(sizeClass == .compact ? 28 : 32)
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
        }.task(id: reduceMotion) {
            guard !reduceMotion, phase == nil else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(12)) } catch { return }
                withAnimation(.easeInOut(duration: 1.2)) { index = (index + 1) % provider.photos.count }
            }
        }
    }
}

struct CameraPreview: View {
    let feed: CameraFeed
    let now: Date
    @Environment(\.motionPhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 12, paused: reduceMotion || phase != nil)) { context in
            let t = phase ?? (reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate)
            GeometryReader { proxy in
                ZStack {
                    Image(feed.asset).resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .scaleEffect(1.025 + sin(t / 8) * 0.015)
                    LinearGradient(colors: [.black.opacity(0.45), .clear, .black.opacity(0.60)], startPoint: .top, endPoint: .bottom)
                    VStack {
                        HStack {
                            HStack(spacing: 7) { Circle().fill(.red).frame(width: 7, height: 7); Text("LIVE").font(.system(size: 12, weight: .bold)) }
                            Spacer()
                            Text("Demo feed").font(.system(size: 13, weight: .medium))
                        }
                        Spacer()
                        HStack(alignment: .bottom) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(feed.name).font(.system(size: 25, weight: .semibold))
                                Text("Simulated camera").font(.system(size: 14))
                            }
                            Spacer()
                            Text(fixtureTime(phase != nil ? now : context.date, format: "HH:mm:ss")).font(.system(size: 14, design: .monospaced)).monospacedDigit()
                        }
                    }.padding(28)
                }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
            }
        }
    }
}

struct CamerasPage: View {
    let provider: any CamerasProvider
    let now: Date
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var expanded: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack {
                    Text("Around the grounds").font(.system(size: sizeClass == .compact ? 28 : 42, weight: .bold))
                    Spacer()
                    Text("2 demo feeds").foregroundStyle(.secondary)
                }
                let columns = sizeClass == .compact ? 1 : 2
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24), count: columns), spacing: 24) {
                    ForEach(provider.feeds) { feed in
                        Button { expanded = expanded == feed.id ? nil : feed.id } label: {
                            CameraPreview(feed: feed, now: now).aspectRatio(4.0 / 3, contentMode: .fit)
                                .clipShape(.rect(cornerRadius: 32))
                        }.buttonStyle(.plain).accessibilityLabel("Enlarge \(feed.name) demo feed")
                    }
                }
                Text("Animated stock photography · No cameras connected").font(.system(size: 17)).foregroundStyle(.secondary)
            }.padding(sizeClass == .compact ? 24 : 64)
        }.sheet(isPresented: Binding(get: { expanded != nil }, set: { if !$0 { expanded = nil } })) {
            if let feed = provider.feeds.first(where: { $0.id == expanded }) {
                ZStack(alignment: .topTrailing) {
                    CameraPreview(feed: feed, now: now).ignoresSafeArea()
                    CircleButton(symbol: "xmark", label: "Close feed", size: 48) { expanded = nil }.padding(24)
                }
            }
        }
    }
}
