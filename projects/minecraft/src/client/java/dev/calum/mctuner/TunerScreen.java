package dev.calum.mctuner;

import net.minecraft.client.ScrollWheelHandler;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.Locale;

public final class TunerScreen extends Screen {
    private final Screen parent;
    private final ScrollWheelHandler previewWheel = new ScrollWheelHandler();
    private int previewSlot = 0;
    private double lastDelta = 0;
    private int lastSlots = 0;
    private int wheelEvents = 0;
    private boolean calibrating = false;
    private double calibrationSum = 0.0;
    private int calibrationEvents = 0;
    private long lastCalibrationEventAt = 0L;
    private String calibrationResult = "Press, then turn one wheel click";
    private Button invertButton;
    private Button discreteButton;

    public TunerScreen(Screen parent) {
        super(Component.literal("Wheel & HUD Tuner"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int x = 20;
        int leftWidth = Math.min(215, this.width / 2 - 30);
        int y = 48;
        this.invertButton = this.addRenderableWidget(Button.builder(invertLabel(), button -> {
            MinecraftTuner.config().invertWheel = !MinecraftTuner.config().invertWheel;
            button.setMessage(invertLabel());
            MinecraftTuner.config().save();
        }).bounds(x, y, leftWidth, 20).build());

        this.discreteButton = this.addRenderableWidget(Button.builder(discreteLabel(), button -> {
            boolean next = !this.minecraft.options.discreteMouseScroll().get();
            this.minecraft.options.discreteMouseScroll().set(next);
            button.setMessage(discreteLabel());
            this.minecraft.options.save();
        }).bounds(x, y + 24, leftWidth, 20).build());

        double sensitivity = this.minecraft.options.mouseWheelSensitivity().get();
        this.addRenderableWidget(new AbstractSliderButton(x, y + 50, leftWidth, 20, Component.empty(), (sensitivity - 0.10) / 2.90) {
            { updateMessage(); }
            @Override protected void updateMessage() {
                setMessage(Component.literal(String.format(Locale.ROOT, "Sensitivity: %.2f", currentSensitivity())));
            }
            @Override protected void applyValue() {
                TunerScreen.this.minecraft.options.mouseWheelSensitivity().set(0.10 + this.value * 2.90);
            }
        });

        this.addRenderableWidget(new AbstractSliderButton(x, y + 76, leftWidth, 20, Component.empty(), MinecraftTuner.config().topCenterOffset / 160.0) {
            { updateMessage(); }
            @Override protected void updateMessage() {
                setMessage(Component.literal("Top center: " + MinecraftTuner.config().topCenterOffset + " px"));
            }
            @Override protected void applyValue() {
                MinecraftTuner.config().topCenterOffset = (int) Math.round(this.value * 160);
                MinecraftTuner.applyHudOffset(TunerScreen.this.minecraft);
            }
        });

        this.addRenderableWidget(Button.builder(Component.literal("Calibrate one click"), button -> {
            calibrating = true;
            calibrationSum = 0.0;
            calibrationEvents = 0;
            lastCalibrationEventAt = 0L;
            calibrationResult = "Turn the wheel one click now";
        }).bounds(this.width - 190, 48, 170, 20).build());

        this.addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
            .bounds(this.width / 2 - 75, this.height - 27, 150, 20).build());
    }

    private double currentSensitivity() {
        return this.minecraft.options.mouseWheelSensitivity().get();
    }

    private Component invertLabel() {
        return Component.literal("Reverse wheel: " + (MinecraftTuner.config().invertWheel ? "On" : "Off"));
    }

    private Component discreteLabel() {
        return Component.literal("Discrete scrolling: " + (this.minecraft.options.discreteMouseScroll().get() ? "On" : "Off"));
    }

    public void recordRawWheel(double raw) {
        if (calibrating) {
            calibrationSum += raw;
            calibrationEvents++;
            lastCalibrationEventAt = System.nanoTime();
        }
    }

    @Override
    public void tick() {
        if (calibrating && calibrationEvents > 0 && System.nanoTime() - lastCalibrationEventAt > 350_000_000L) {
            calibrating = false;
            double measured = Math.abs(calibrationSum);
            if (measured < 0.01) {
                calibrationResult = "No usable wheel movement; try again";
                return;
            }
            MinecraftTuner.config().wheelDivisor = measured * currentSensitivity() * (1.0 - 1e-9);
            this.minecraft.options.discreteMouseScroll().set(false);
            this.discreteButton.setMessage(discreteLabel());
            MinecraftTuner.save(this.minecraft);
            calibrationResult = String.format(Locale.ROOT, "%d events, raw total %.3f", calibrationEvents, measured);
        }
    }

    @Override
    public boolean mouseScrolled(double x, double y, double scrollX, double scrollY) {
        this.lastDelta = scrollY;
        this.wheelEvents++;
        var steps = this.previewWheel.onMouseScroll(scrollX, scrollY);
        int wheel = steps.y == 0 ? -steps.x : steps.y;
        this.lastSlots = Math.abs(wheel);
        for (int i = 0; i < Math.abs(wheel); i++) {
            this.previewSlot = ScrollWheelHandler.getNextScrollWheelSelection(Math.signum(wheel), this.previewSlot, 9);
        }
        return true;
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float a) {
        super.extractRenderState(graphics, mouseX, mouseY, a);
        graphics.text(this.font, Component.literal("Wheel & HUD Tuner"), 20, 12, 0xFFFFFFFF);
        int centerX = this.width / 2;
        int previewY = 12 + MinecraftTuner.config().topCenterOffset;
        String hud = MinecraftTuner.hasJade() ? "Stone  |  Minecraft" : "Top-center overlay";
        int hudX = centerX - this.font.width(hud) / 2;
        graphics.fill(centerX, 0, centerX + 1, previewY - 3, 0x55FFFFFF);
        graphics.fill(hudX - 4, previewY - 3, hudX + this.font.width(hud) + 4, previewY + 12, 0xAA202020);
        graphics.text(this.font, Component.literal(hud), hudX, previewY, 0xFFFFFFFF);

        graphics.text(this.font, Component.literal("Scroll here to test hotbar"), 20, 156, 0xFFFFFFFF);
        int slotX = 20;
        int slotY = 171;
        int size = Math.max(16, Math.min(22, (Math.min(215, this.width / 2 - 30) - 8) / 9));
        for (int i = 0; i < 9; i++) {
            int xx = slotX + i * (size + 1);
            graphics.fill(xx, slotY, xx + size, slotY + size, i == this.previewSlot ? 0xFFFFFFFF : 0xFF555555);
            graphics.fill(xx + 2, slotY + 2, xx + size - 2, slotY + size - 2, 0xCC222222);
            graphics.text(this.font, Component.literal(Integer.toString(i + 1)), xx + 5, slotY + 5, 0xFFFFFFFF);
        }
        graphics.text(this.font, Component.literal(String.format(Locale.ROOT,
            "Last event: %+.2f = %d slot(s)", this.lastDelta, this.lastSlots)), 20, 200, 0xFFFFFFFF);
        graphics.text(this.font, Component.literal("Wheel events: " + this.wheelEvents), 20, 212, 0xFFAAAAAA);
        graphics.text(this.font, Component.literal(calibrationResult), this.width - 190, 74, 0xFFFFFFFF);
        graphics.text(this.font, Component.literal(String.format(Locale.ROOT, "Divisor: %.3f", MinecraftTuner.config().wheelDivisor)),
            this.width - 190, 88, 0xFFAAAAAA);
    }

    @Override
    public void onClose() {
        MinecraftTuner.save(this.minecraft);
        this.minecraft.gui.setScreen(this.parent);
    }
}
