import Charts
import FoldingData
import FoldingDomain
import SwiftUI

struct HistoryScreen: View {
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @State private var selectedBinIndex: Int?

  var body: some View {
    GeometryReader { geometry in
      if geometry.size.width >= 700 {
        ScrollView {
          HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 18) { summaryContent }
              .padding(20)
              .frame(maxWidth: .infinity, alignment: .leading)
              .frame(minHeight: max(240, geometry.size.height - 40), alignment: .top)
              .background(
                FoldingSurface.card,
                in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius))
            VStack(alignment: .leading, spacing: 12) {
              if model.history != nil {
                Text(String(localized: "history.sessions", defaultValue: "Sessions"))
                  .font(.headline)
                ScrollView {
                  LazyVStack(alignment: .leading, spacing: 16) { sessionsContent }
                }
                .frame(height: max(240, geometry.size.height - 120))
              }
            }
            .padding(20)
            .frame(width: min(380, geometry.size.width * 0.38), alignment: .leading)
            .frame(minHeight: max(240, geometry.size.height - 40), alignment: .top)
            .background(
              FoldingSurface.card,
              in: RoundedRectangle(cornerRadius: FoldingShape.cornerRadius))
          }
          .padding(20)
        }
        .background(FoldingSurface.background)
      } else {
        List {
          Section { summaryContent }
          if model.history != nil {
            Section(String(localized: "history.sessions", defaultValue: "Sessions")) {
              ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) { sessionsContent }
                  .padding(.vertical, 8)
              }
              .frame(height: min(360, max(160, geometry.size.height * 0.45)))
            }
          }
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          model.present(.patterns)
        } label: {
          Image(systemName: "chart.bar")
        }
        .accessibilityLabel(String(localized: "patterns.title", defaultValue: "Patterns"))
        .disabled(actions.loadPatterns == nil)
      }
    }
    .overlay(alignment: .top) {
      if model.historyLoading, model.history != nil { ProgressView().padding(8) }
    }
    .onChange(of: model.historyPeriod) { _, _ in model.historyOffset = 0 }
    .task(id: "\(model.historyPeriod.rawValue)-\(model.historyOffset)") {
      await model.requestHistory(using: actions)
    }
  }

  @ViewBuilder private var summaryContent: some View {
    Picker(
      String(localized: "history.interval", defaultValue: "Interval"),
      selection: $model.historyPeriod
    ) {
      ForEach(HistoryPeriod.allCases) { Text($0.title).tag($0) }
    }.pickerStyle(.segmented)
      .disabled(actions.loadHistory == nil)
      .listRowSeparator(.hidden)
    if let history = model.history {
      HStack {
        Button {
          model.historyOffset -= 1
        } label: {
          Image(systemName: "chevron.left")
        }.buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
          .accessibilityLabel(
            String(localized: "history.previous", defaultValue: "Previous period")
          )
          .disabled(actions.loadHistory == nil || model.historyLoading || !history.canGoPrevious)
        Text(history.title).font(.headline).frame(maxWidth: .infinity)
        Button {
          model.historyOffset += 1
        } label: {
          Image(systemName: "chevron.right")
        }.buttonStyle(.borderless).frame(minWidth: 44, minHeight: 44)
          .accessibilityLabel(String(localized: "history.next", defaultValue: "Next period"))
          .disabled(
            model.historyOffset >= 0 || actions.loadHistory == nil
              || model.historyPeriod == .all)
      }.listRowSeparator(.hidden)
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(history.folds, format: .number)
          .font(.system(size: 44, weight: .bold, design: .rounded))
          .monospacedDigit()
        Text(String(localized: "metric.folds", defaultValue: "Folds"))
          .font(.subheadline).foregroundStyle(.secondary)
      }.listRowSeparator(.hidden)
      if !history.bins.isEmpty {
        Chart(0..<history.bins.count, id: \.self) { index in
          let bin = history.bins[index]
          BarMark(
            x: .value(String(localized: "chart.date", defaultValue: "Date"), index),
            y: .value(String(localized: "metric.folds", defaultValue: "Folds"), bin.folds),
            width: .fixed(history.bins.count > 14 ? 10 : 24)
          )
          .foregroundStyle(
            selectedBinIndex.map({ $0 == index }) == false
              ? FoldingTint.color.opacity(0.4) : FoldingTint.color
          )
          .cornerRadius(5)
          .accessibilityLabel(bin.label).accessibilityValue(bin.folds.formatted())
        }
        .chartXScale(domain: -0.5...(Double(history.bins.count) - 0.5))
        .chartYAxis(.hidden)
        .chartXAxis {
          AxisMarks(
            preset: .aligned,
            values: Array(
              stride(
                from: 0, to: history.bins.count,
                by: max(1, Int(ceil(Double(history.bins.count) / 7)))))
          ) { value in
            AxisValueLabel(centered: false, anchor: .top, offsetsMarks: false) {
              if let index = value.as(Int.self), history.bins.indices.contains(index) {
                Text(history.bins[index].label)
              }
            }
          }
        }
        .chartXSelection(value: $selectedBinIndex)
        .onChange(of: history.bins.map(\.start)) { _, _ in selectedBinIndex = nil }
        .frame(height: 180)
        .listRowSeparator(.hidden)
        if let index = selectedBinIndex, history.bins.indices.contains(index) {
          HStack {
            if model.historyPeriod == .month {
              Text(history.bins[index].start, format: .dateTime.month(.wide).day())
            } else {
              Text(history.bins[index].label)
            }
            Spacer()
            Text(history.bins[index].folds, format: .number).monospacedDigit()
          }
        }
      }
      if model.entryDeletionPending {
        Label(
          String(localized: "history.deletionPending", defaultValue: "Leaderboard update pending"),
          systemImage: "clock"
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      if model.historyFailed {
        Button(String(localized: "action.retry", defaultValue: "Retry")) {
          Task { await model.requestHistory(using: actions) }
        }
      }
    } else if model.historyLoading {
      ProgressView().frame(maxWidth: .infinity)
    } else {
      ContentUnavailableView(
        String(localized: "history.unavailable", defaultValue: "History unavailable"),
        systemImage: "clock")
    }
  }

  @ViewBuilder private var sessionsContent: some View {
    if let history = model.history {
      if history.sessions.isEmpty {
        Text(String(localized: "history.noSessions", defaultValue: "No sessions yet"))
          .foregroundStyle(.secondary)
      }
      ForEach(Array(history.sessions.enumerated()), id: \.offset) { _, session in
        NavigationLink(value: HistoryRoute.session(SessionPresentation(session))) {
          HStack {
            Text(
              Date(timeIntervalSince1970: Double(session.startMS) / 1000),
              format: .dateTime.month(.abbreviated).day().hour().minute())
            Spacer()
            Text(session.durationMS.map(foldingDuration) ?? session.completeness.title)
              .foregroundStyle(.secondary)
          }
        }
        .buttonStyle(.plain)
      }
    }
  }
}

struct SessionScreen: View {
  let session: SessionPresentation
  @Bindable var model: FoldingPresentation
  let actions: FoldingActions
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingDeletion = false
  var body: some View {
    Form {
      LabeledContent(String(localized: "session.opened", defaultValue: "Opened")) {
        Text(session.start, format: .dateTime.month().day().hour().minute())
      }
      if let end = session.end {
        LabeledContent(String(localized: "session.closed", defaultValue: "Closed")) {
          Text(end, format: .dateTime.month().day().hour().minute())
        }
      }
      LabeledContent(
        String(localized: "metric.timeUnfolded", defaultValue: "Time unfolded"),
        value: session.durationMS.map(foldingDuration) ?? "—")
      Label(
        session.completeness.title,
        systemImage: session.completeness == .incomplete ? "exclamationmark.circle" : "clock")
    }
    .toolbar {
      if session.completeness == .incomplete, actions.deleteIncompleteEntry != nil {
        ToolbarItem(placement: .topBarTrailing) {
          Button(role: .destructive) {
            confirmingDeletion = true
          } label: {
            Image(systemName: "trash")
          }
          .accessibilityLabel(
            String(localized: "history.deleteEntry", defaultValue: "Delete entry")
          )
          .disabled(model.operation != nil)
        }
      }
    }
    .confirmationDialog(
      String(localized: "history.deleteTitle", defaultValue: "Delete this entry?"),
      isPresented: $confirmingDeletion, titleVisibility: .visible
    ) {
      Button(
        String(localized: "history.deleteEntry", defaultValue: "Delete entry"), role: .destructive
      ) {
        guard let remove = actions.deleteIncompleteEntry else { return }
        Task {
          await model.command(String(localized: "settings.saving", defaultValue: "Saving")) {
            try await remove(session.deletionTarget)
            dismiss()
          }
        }
      }
    } message: {
      Text(
        String(
          localized: "history.deleteEffect",
          defaultValue: "Removes its folds from your totals and leaderboards."))
    }
    .navigationTitle(String(localized: "history.session", defaultValue: "Session"))
    .navigationBarTitleDisplayMode(.inline)
  }
}
