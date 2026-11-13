# Tendr releases go live as soon as Apple approves them. Other apps retain
# their existing App Store Connect release preference.
module ReleasePolicy
  def self.automatic?(config)
    config["bundle_id"] == "com.calumwebb.still" ? true : nil
  end

  # Submission lanes skip deliver's metadata upload, so its automatic_release
  # option alone would be ignored. Set the policy explicitly before submitting.
  def self.apply!(asc, config, version_id)
    return unless automatic?(config)
    asc.patch(
      "v1/appStoreVersions/#{version_id}",
      {
        data: {
          type: "appStoreVersions",
          id: version_id,
          attributes: {
            releaseType: "AFTER_APPROVAL"
          }
        }
      }
    )
  end
end
