package dev.calum.mctuner;

import dev.calum.mctuner.mixin.ScreenAccessor;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.options.MouseSettingsScreen;
import net.minecraft.client.gui.screens.options.VideoSettingsScreen;
import net.minecraft.network.chat.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class MinecraftTuner implements ClientModInitializer {
    public static final Logger LOGGER = LoggerFactory.getLogger("minecraft-tuner");
    private static final TunerConfig CONFIG = TunerConfig.load();
    private static final boolean HAS_JADE = FabricLoader.getInstance().isModLoaded("jade");

    public static TunerConfig config() {
        return CONFIG;
    }

    public static boolean hasJade() {
        return HAS_JADE;
    }

    public static void applyHudOffset(Minecraft client) {
        if (HAS_JADE && client.getWindow() != null) {
            JadePosition.apply(CONFIG.topCenterOffset, client.getWindow().getGuiScaledHeight());
        }
    }

    public static void save(Minecraft client) {
        CONFIG.save();
        client.options.save();
        if (HAS_JADE) {
            JadePosition.save();
        }
    }

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(MinecraftTuner::applyHudOffset);
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (screen instanceof MouseSettingsScreen || screen instanceof VideoSettingsScreen) {
                ((ScreenAccessor) screen).minecraftTuner$addWidget(Button.builder(
                    Component.literal("Wheel & HUD Tuner"),
                    button -> client.gui.setScreen(new TunerScreen(screen))
                ).bounds(width - 158, 6, 150, 20).build());
            }
        });
    }
}
