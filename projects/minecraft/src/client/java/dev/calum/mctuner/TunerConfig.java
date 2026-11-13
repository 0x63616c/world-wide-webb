package dev.calum.mctuner;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class TunerConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path PATH = FabricLoader.getInstance().getConfigDir().resolve("minecraft-tuner.json");
    public boolean invertWheel = false;
    public int topCenterOffset = 0;
    public double wheelDivisor = 1.0;

    public static TunerConfig load() {
        if (Files.exists(PATH)) {
            try {
                TunerConfig config = GSON.fromJson(Files.readString(PATH), TunerConfig.class);
                if (config != null) {
                    config.topCenterOffset = Math.clamp(config.topCenterOffset, 0, 160);
                    if (!Double.isFinite(config.wheelDivisor) || config.wheelDivisor <= 0.0) {
                        config.wheelDivisor = 1.0;
                    }
                    return config;
                }
            } catch (Exception e) {
                MinecraftTuner.LOGGER.warn("Could not read tuner config", e);
            }
        }
        return new TunerConfig();
    }

    public void save() {
        try {
            Files.createDirectories(PATH.getParent());
            Files.writeString(PATH, GSON.toJson(this));
        } catch (IOException e) {
            MinecraftTuner.LOGGER.error("Could not save tuner config", e);
        }
    }
}
