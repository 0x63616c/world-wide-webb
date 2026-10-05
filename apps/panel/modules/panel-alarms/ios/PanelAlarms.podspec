Pod::Spec.new do |s|
  s.name = 'PanelAlarms'
  s.version = '1.0.0'
  s.summary = 'Control Center alarm countdown and Siri transport'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Control Center'
  s.homepage = 'https://github.com/0x63616c/world-wide-webb'
  s.source = { git: s.homepage }
  s.platforms = { ios: '16.2' }
  s.swift_version = '5.0'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'ActivityKit', 'Security'
end
