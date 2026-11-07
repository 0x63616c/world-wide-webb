import SwiftUI

struct PhotoBoothGallery: View {
    let provider: LivePhotosProvider
    let photos: [LivePhoto]
    let back: () -> Void
    let open: (LivePhoto.ID) -> Void
    @Environment(\.calendar) private var calendar
    @Environment(\.timeZone) private var timeZone
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 2), count: sizeClass == .compact ? 3 : 6)
    }

    private var days: [(date: Date, photos: [LivePhoto])] {
        var calendar = calendar
        calendar.timeZone = timeZone
        return Dictionary(grouping: photos) { calendar.startOfDay(for: $0.date) }
            .map { ($0.key, $0.value) }.sorted { $0.date > $1.date }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                PhotoBoothNavigationButton(symbol: "chevron.left", title: "Back to camera", identifier: "booth-gallery-back", action: back)
                Text("Booth photos").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
            }.padding(.horizontal, 20).padding(.vertical, 12)
            Divider()
            if photos.isEmpty {
                switch provider.availability {
                case .loading: ProgressView().frame(maxHeight: .infinity)
                default: ContentUnavailableView("No booth photos yet", systemImage: "photo.on.rectangle")
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 2, pinnedViews: [.sectionHeaders]) {
                        ForEach(days, id: \.date) { day in
                            Section {
                                ForEach(day.photos) { photo in
                                    Button { open(photo.id) } label: {
                                        Color(uiColor: .secondarySystemBackground)
                                            .aspectRatio(1, contentMode: .fit)
                                            .overlay {
                                                AuthenticatedPhoto(provider: provider, photo: photo,
                                                    mode: .fill, thumbnailSize: 230)
                                            }.clipped().contentShape(.rect)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(photo.date.formatted(date: .abbreviated, time: .shortened))
                                    .accessibilityIdentifier("booth-photo-\(photo.id)")
                                }
                            } header: {
                                dateHeader(day.date)
                            }
                        }
                    }.padding(.horizontal, 20).padding(.bottom, 20)
                }
                .accessibilityIdentifier("booth-gallery-scroll")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { Color(uiColor: .systemBackground).ignoresSafeArea() }
        .foregroundStyle(Color(uiColor: .label))
        .accessibilityElement(children: .contain).accessibilityIdentifier("booth-photos")
    }

    private func dateHeader(_ date: Date) -> some View {
        var calendar = calendar
        calendar.timeZone = timeZone
        let title = calendar.isDateInToday(date) ? String(localized: "Today")
            : calendar.isDateInYesterday(date) ? String(localized: "Yesterday")
            : date.formatted(date: .abbreviated, time: .omitted)
        return Text(title)
            .font(.title3.bold())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 14).padding(.bottom, 9)
            .background(Color(uiColor: .systemBackground))
            .accessibilityAddTraits(.isHeader)
    }
}

struct PhotoBoothViewer: View {
    let provider: LivePhotosProvider
    let photos: [LivePhoto]
    @Binding var selection: LivePhoto.ID?
    let back: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var currentIndex: Int? { photos.firstIndex { $0.id == selection } }

    var body: some View {
        VStack(spacing: 12) {
            PhotoBoothBar(back: back, identifier: "booth-viewer-back") {
                if let currentIndex {
                    let date = photos[currentIndex].date
                    VStack(spacing: 2) {
                        Text(date, format: .dateTime.month(.abbreviated).day().year()).font(.headline)
                        Text(date, format: .dateTime.hour().minute()).font(.subheadline).foregroundStyle(.secondary)
                    }.accessibilityElement(children: .combine)
                }
            }
            if let currentIndex {
                let radius = sizeClass == .compact ? 2 : 4
                let nearby = photos[max(0, currentIndex - radius)..<min(photos.count, currentIndex + radius + 1)]
                TabView(selection: $selection) {
                    ForEach(photos) { photo in
                        AuthenticatedPhoto(provider: provider, photo: photo)
                            .padding(.horizontal, 24)
                            .accessibilityIdentifier("booth-photo-detail")
                            .tag(Optional(photo.id))
                    }
                }.tabViewStyle(.page(indexDisplayMode: .never))

                HStack(spacing: 6) {
                    ForEach(nearby) { photo in
                        Button { selection = photo.id } label: {
                            AuthenticatedPhoto(provider: provider, photo: photo, mode: .fill, thumbnailSize: 56)
                                .frame(width: 44, height: 44)
                                .clipShape(.rect(cornerRadius: 5))
                                .overlay {
                                    if selection == photo.id {
                                        RoundedRectangle(cornerRadius: 5).strokeBorder(.white, lineWidth: 2)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(photo.date.formatted(date: .abbreviated, time: .shortened))
                        .accessibilityAddTraits(selection == photo.id ? .isSelected : [])
                    }
                }.padding(.bottom, 14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { Color.black.ignoresSafeArea() }
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .onChange(of: photos) { _, updated in
            if !updated.contains(where: { $0.id == selection }) { back() }
        }
    }
}

struct PhotoBoothBar<Title: View>: View {
    let back: () -> Void
    var identifier = "app-back"
    @ViewBuilder let title: () -> Title

    var body: some View {
        title()
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 78)
            .overlay(alignment: .leading) {
                PhotoBoothNavigationButton(symbol: "chevron.left", title: "Back", identifier: identifier, action: back)
                    .padding(.leading, 20)
            }.padding(.top, 14)
    }
}

struct PhotoBoothNavigationButton: View {
    let symbol: String
    let title: String
    var identifier = "app-back"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .frame(width: 48, height: 48)
        }
        .buttonStyle(.glass).buttonBorderShape(.circle)
        .accessibilityLabel(title).accessibilityIdentifier(identifier)
    }
}

private extension LivePhoto {
    var date: Date { Date(timeIntervalSince1970: capturedAt / 1000) }
}
