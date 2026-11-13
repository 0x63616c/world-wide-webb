package dev.calum.mctuner;

import snownee.jade.api.config.IWailaConfig;

final class JadePosition {
    private JadePosition() {}

    static void apply(int pixels, int guiHeight) {
        if (guiHeight > 0) {
            float position = 1.0f - Math.clamp(pixels / (float) guiHeight, 0.0f, 1.0f);
            IWailaConfig.get().overlay().setOverlayPosY(position);
        }
    }

    static void save() {
        IWailaConfig.get().save();
    }
}
