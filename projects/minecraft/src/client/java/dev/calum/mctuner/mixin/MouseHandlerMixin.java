package dev.calum.mctuner.mixin;

import dev.calum.mctuner.MinecraftTuner;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(MouseHandler.class)
public class MouseHandlerMixin {
    @ModifyVariable(method = "onScroll", at = @At("HEAD"), argsOnly = true, ordinal = 1)
    private double minecraftTuner$invertWheel(double yOffset) {
        return MinecraftTuner.transformWheel(yOffset);
    }
}
