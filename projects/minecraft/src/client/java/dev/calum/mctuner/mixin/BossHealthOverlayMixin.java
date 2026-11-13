package dev.calum.mctuner.mixin;

import dev.calum.mctuner.MinecraftTuner;
import net.minecraft.client.gui.components.BossHealthOverlay;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.ModifyConstant;

@Mixin(BossHealthOverlay.class)
public class BossHealthOverlayMixin {
    @ModifyConstant(method = "extractRenderState", constant = @Constant(intValue = 12))
    private int minecraftTuner$moveBossBars(int original) {
        return original + MinecraftTuner.config().topCenterOffset;
    }
}
