import RDesign
import SwiftUI

private struct Editorial: Identifiable {
    let id: String
    let category: String
    let title: String
    let summary: String
    let duration: String
    let sections: [(String, String)]
    static let collection: [Editorial] = [
        .init(id: "journal", category: "Everyday", title: "A little routine.\nA clearer picture.", summary: "Make room for a two-minute check-in.", duration: "2 min read", sections: [
            ("Keep it easy", "Choose a moment that already belongs to your day: after brushing your teeth, before breakfast, or when you put your phone on charge. Open your journal and record what you want to remember."),
            ("Leave yourself a useful note", "A short observation is enough. You might note when you weighed yourself, how your appetite felt, or a question you want to take to your next appointment."),
            ("Come back without catching up", "A missed entry does not need a perfect reconstruction. Add what you remember, choose the actual date, and carry on from today.")]),
        .init(id: "bowl", category: "Recipes", title: "The five-minute\nyogurt bowl", summary: "Yogurt, berries and a little crunch.", duration: "5 min · 1 serving", sections: [
            ("Ingredients", "150 g plain Greek yogurt\n½ cup berries, washed\n2 tablespoons rolled oats\n1 tablespoon chopped nuts, optional\nA pinch of cinnamon"),
            ("Put it together", "Spoon the yogurt into a bowl. Add the berries and oats, then finish with nuts and cinnamon. Use a dairy-free alternative or leave out the nuts if needed for your dietary preferences or allergies."),
            ("Make it yours", "Swap the berries for chopped peach or pear. For softer oats, stir them into the yogurt the night before and refrigerate. This is a recipe idea, not a personalized meal plan.")]),
        .init(id: "appointment", category: "Everyday", title: "Your next appointment,\na little more prepared", summary: "Turn your notes into questions that matter.", duration: "2 min read", sections: [
            ("Start with your journal", "Look back at your recorded doses, dates and notes. If something is missing or uncertain, mark that down instead of guessing."),
            ("Pick your questions", "What has been easy? What has been difficult? Is there a pattern you would like your clinician to help explain? Bring questions about your medication and schedule to the person prescribing it."),
            ("Keep estimates in context", "The medication graph is a simplified model based on your entries, not a measurement. Share your actual dose records and observations alongside any chart.")])
    ]
}

struct DiscoverView: View {
    @State private var category = "All"
    private var articles: [Editorial] { Editorial.collection.filter { category == "All" || $0.category == category } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("READ. COOK. RESET.").font(.caption2.weight(.semibold)).tracking(2).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        ForEach(["All", "Everyday", "Recipes"], id: \.self) { item in
                            Button { category = item } label: {
                                Text(item).font(.subheadline.weight(.semibold)).padding(.horizontal, 18).padding(.vertical, 10)
                                    .background(category == item ? Color.primary : Theme.card, in: Capsule())
                                    .foregroundStyle(category == item ? Theme.background : Color.secondary)
                            }.buttonStyle(.plain)
                        }
                    }
                    ForEach(articles) { article in
                        NavigationLink { ArticleView(article: article) } label: {
                            VStack(alignment: .leading, spacing: article.id == "journal" ? 24 : 18) {
                                HStack {
                                    Text(article.category.uppercased()).font(.caption2.weight(.semibold)).tracking(1.5)
                                    Spacer()
                                    Text(article.duration).font(.caption)
                                }.foregroundStyle(.secondary)
                                Text(article.title)
                                    .font(.system(size: article.id == "journal" ? 34 : 26, weight: .semibold))
                                    .tracking(-0.9).fixedSize(horizontal: false, vertical: true).foregroundStyle(.primary)
                                Text(article.summary).font(.subheadline).foregroundStyle(.secondary)
                                if article.id == "journal" {
                                    Rectangle().fill(.primary.opacity(0.12)).frame(height: 1)
                                    HStack {
                                        Text("THIS WEEK'S READ").font(.system(size: 10, weight: .medium)).tracking(1.5).foregroundStyle(.secondary)
                                        Spacer()
                                        Text("Read story").font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                    }
                                }
                            }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
                                .rSurface(Theme.card, cornerRadius: 18)
                        }.buttonStyle(.plain)
                    }
                    if FeatureFlags.assistantPreview { NavigationLink { AssistantPreview() } label: {
                        HStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 5) { Text("A space to talk").font(.headline); Text("Assistant · Coming soon").font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }.card()
                    }.buttonStyle(.plain) }
                }.padding(16).padding(.bottom, 16).tendrReadableWidth()
            }.background(Theme.background).navigationTitle("Discover")
        }
    }
}

private struct ArticleView: View {
    let article: Editorial
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(article.category) · \(article.duration)").font(.caption.weight(.semibold)).foregroundStyle(Theme.pine)
                    Text(article.title).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
                    Text("Tendr editorial").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(article.sections.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(article.sections[index].0).font(.title3.bold())
                        Text(article.sections[index].1).font(.body).lineSpacing(6).foregroundStyle(.secondary)
                    }
                }
            }.padding(20).padding(.bottom, 24).tendrReadableWidth()
        }.background(Theme.background).navigationBarTitleDisplayMode(.inline)
    }
}
