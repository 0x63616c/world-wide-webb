cfg:
(if cfg.containers.enable then cfg.containers.services else [])
++ (if cfg.homeassistant.enable then [ "home-assistant" ] else [])
