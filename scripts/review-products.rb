# Joint review submission using Apple's version-based IAP API (4.4.1+).
# No product creation, pricing writes, withdrawal, or implicit build selection.
class ReviewProducts
  attr_reader :targets, :submission_id

  def initialize(asc, app_id, version_id)
    @asc, @app_id, @version_id = asc, app_id, version_id
    @targets = [["appStoreVersion", "appStoreVersions", version_id]]
  end

  def all(path, params = nil)
    rows = []
    loop do
      body = @asc.get(path, params).body
      rows.concat(body.fetch("data"))
      path = body.dig("links", "next")
      break unless path
      params = nil
    end
    rows
  end

  def inventory!
    @targets = [["appStoreVersion", "appStoreVersions", @version_id]]
    all("v1/apps/#{@app_id}/inAppPurchasesV2").each do |product|
      product!(product, "v2/inAppPurchases", "inAppPurchaseVersion", "inAppPurchaseVersions")
    end
    groups = all("v1/apps/#{@app_id}/subscriptionGroups")
    puts "SUBSCRIPTION_GROUPS: #{groups.length}"
    groups.each do |group|
      subscriptions = all("v1/subscriptionGroups/#{group['id']}/subscriptions")
      before = @targets.length
      subscriptions.each { |product| product!(product, "v1/subscriptions", "subscriptionVersion", "subscriptionVersions") }
      next if @targets.length == before
      all("v1/subscriptionGroups/#{group['id']}/versions").each do |version|
        next unless %w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW REJECTED DEVELOPER_REJECTED].include?(version.dig("attributes", "state"))
        @targets << ["subscriptionGroupVersion", "subscriptionGroupVersions", version.fetch("id")]
      end
    end
    submissions = all("v1/reviewSubmissions", { "filter[app]" => @app_id, "filter[platform]" => "IOS" })
    raise "An iOS submission is already in progress; leaving it untouched" if submissions.any? { |s| %w[WAITING_FOR_REVIEW IN_REVIEW CANCELING COMPLETING].include?(s.dig("attributes", "state")) }
    drafts = submissions.select { |s| %w[READY_FOR_REVIEW UNRESOLVED_ISSUES].include?(s.dig("attributes", "state")) }
    raise "Multiple open submissions; select one in App Store Connect" if drafts.length > 1
    @submission_id = drafts.first&.fetch("id")
    validate_items!(items) if @submission_id
    self
  end

  def product!(product, path, relation, type)
    state = product.dig("attributes", "state")
    label = product.dig("attributes", "productId")
    puts "PRODUCT: #{label} #{state} id=#{product['id']}"
    return if state == "APPROVED"
    raise "#{label}: #{state}; complete metadata, pricing and review screenshot before submission (prices and products are never changed by this lane)" unless %w[READY_TO_SUBMIT WAITING_FOR_REVIEW IN_REVIEW PENDING_BINARY_APPROVAL].include?(state)
    versions = all("#{path}/#{product.fetch('id')}/versions")
    draft = versions.select { |v| %w[PREPARE_FOR_SUBMISSION READY_FOR_REVIEW REJECTED DEVELOPER_REJECTED].include?(v.dig("attributes", "state")) }
    raise "#{label}: expected exactly one reviewable version, found #{draft.length}" unless draft.length == 1
    @targets << [relation, type, draft.first.fetch("id")]
    puts "PRODUCT_VERSION: #{label} #{draft.first.fetch('id')} #{draft.first.dig('attributes', 'state')}"
  end

  def items
    all("v1/reviewSubmissions/#{@submission_id}/items", { "include" => "appStoreVersion,inAppPurchaseVersion,subscriptionVersion,subscriptionGroupVersion" })
  end

  def matches?(item, target)
    item.dig("relationships", target[0], "data", "id") == target[2]
  end

  def validate_items!(rows)
    rows.each do |item|
      next if item.dig("attributes", "state") == "REMOVED"
      raise "Submission contains an unrelated item #{item['id']}; leaving it untouched" unless @targets.any? { |target| matches?(item, target) }
    end
  end

  def submit!
    if @submission_id
      current = @asc.get("v1/reviewSubmissions/#{@submission_id}").body.fetch("data")
      rows = items
      validate_items!(rows)
      missing = @targets.any? { |target| rows.none? { |item| matches?(item, target) && item.dig("attributes", "state") != "REMOVED" } }
      if current.dig("attributes", "state") == "UNRESOLVED_ISSUES" && missing
        # Apple forbids adding products to a rejected submission. Release only
        # our rejected items, preserving its history, then assemble a new draft.
        active = rows.reject { |item| item.dig("attributes", "state") == "REMOVED" }
        raise "Cannot rebuild a submission containing non-rejected items" unless active.all? { |item| item.dig("attributes", "state") == "REJECTED" }
        active.each do |item|
          @asc.patch("v1/reviewSubmissionItems/#{item['id']}", { data: { type: "reviewSubmissionItems", id: item["id"], attributes: { removed: true } } })
          puts "REMOVED_REJECTED_ITEM: #{item['id']} from #{@submission_id}"
        end
        complete = false
        20.times do
          state = @asc.get("v1/reviewSubmissions/#{@submission_id}").body.dig("data", "attributes", "state")
          if state == "COMPLETE"
            complete = true
            break
          end
          sleep 3
        end
        raise "Rejected submission removal is still processing; rerun after it completes" unless complete
        @submission_id = nil
      elsif !%w[READY_FOR_REVIEW UNRESOLVED_ISSUES].include?(current.dig("attributes", "state"))
        raise "Submission state changed; leaving it untouched"
      end
    end
    unless @submission_id
      @submission_id = @asc.post("v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: {
        app: { data: { type: "apps", id: @app_id } }
      } } }).body.fetch("data").fetch("id")
    end
    rows = items
    validate_items!(rows)
    @targets.each do |target|
      existing = rows.find { |item| matches?(item, target) && item.dig("attributes", "state") != "REMOVED" }
      next if existing
      @asc.post("v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: {
        reviewSubmission: { data: { type: "reviewSubmissions", id: @submission_id } },
        target[0] => { data: { type: target[1], id: target[2] } }
      } } })
      puts "ATTACHED: #{target[0]} #{target[2]} submission #{@submission_id}"
    end
    rows = items
    validate_items!(rows)
    raise "Not every expected product is attached" unless @targets.all? { |target| rows.any? { |item| matches?(item, target) && item.dig("attributes", "state") != "REMOVED" } }
    # Resolve only the known items after every missing product has been attached.
    rows.select { |item| item.dig("attributes", "state") == "REJECTED" }.each do |item|
      @asc.patch("v1/reviewSubmissionItems/#{item['id']}", { data: { type: "reviewSubmissionItems", id: item["id"], attributes: { resolved: true } } })
    end
    result = @asc.patch("v1/reviewSubmissions/#{@submission_id}", { data: { type: "reviewSubmissions", id: @submission_id, attributes: { submitted: true } } }).body
    puts "SUBMIT: #{result.dig('data', 'attributes', 'state')} submission #{@submission_id}"
    status!
  end

  def status!
    @targets.each do |target|
      state = @asc.get("v1/#{target[1]}/#{target[2]}").body.dig("data", "attributes")
      puts "FINAL: #{target[0]} #{target[2]} #{state['appVersionState'] || state['state'] || state['appStoreState']}"
    end
  end
end

# deliver still selects the exact build and performs its compliance checks. Replace
# only its app-only submission step, scoped to the invocation of this lane.
module DeliverWithProducts
  def create_review_submission(options, app, version, platform)
    coordinator = Thread.current[:review_products]
    return super unless coordinator
    raise "deliver selected an unexpected app version" unless coordinator.targets.include?(["appStoreVersion", "appStoreVersions", version.id])
    coordinator.submit!
  end
end
