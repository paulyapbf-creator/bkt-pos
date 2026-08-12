package com.example.printerdemo;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.widget.ImageView;

import com.cloudpos.POSTerminal;
import com.cloudpos.secondarydisplay.SecondaryDisplayDevice;
import com.cloudpos.jniinterface.SecondaryDisplayInterface;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class CustomerDisplayManager {

    public interface LogListener {
        void onLog(String message);
    }

    // Two render modes — whichever init() finds first
    private enum Mode { NONE, PRESENTATION, SDK_DEVICE, CLOUDPOS_JNI }

    private static final String[] SDK_DEVICE_NAMES = {
        "cloudpos.device.secondarydisplay",
        "com.cloudpos.device.secondarydisplay",
    };

    private final Context context;
    private Mode mode = Mode.NONE;

    // Presentation path
    private Display secondaryDisplay;
    private DisplayPresentation currentPresentation;

    // CloudPOS path
    private SecondaryDisplayDevice sdkDevice;

    private int displayW = 320;
    private int displayH = 240;
    private final StringBuilder diagLog = new StringBuilder();

    public CustomerDisplayManager(Context context) {
        this.context = context;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Call on a background thread. */
    public void init(LogListener listener) {
        diagLog.setLength(0);
        mode = Mode.NONE;
        sdkDevice = null;
        secondaryDisplay = null;
        dismissPresentation();

        log(listener, "--- Init Customer Display ---");

        // ── Path 1: Android Presentation API (no special permissions needed) ──
        log(listener, "Trying Android DisplayManager...");
        DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        Display[] displays = dm.getDisplays();
        log(listener, "Total displays: " + displays.length);
        for (Display d : displays) {
            log(listener, "  [" + d.getDisplayId() + "] " + d.getName()
                    + " state=" + d.getState()
                    + " size=" + displaySizeOf(d));
            if (d.getDisplayId() != Display.DEFAULT_DISPLAY) {
                secondaryDisplay = d;
            }
        }
        if (secondaryDisplay != null) {
            mode = Mode.PRESENTATION;
            log(listener, "Presentation mode: " + secondaryDisplay.getName());
            log(listener, "Display ready");
            return;
        }
        log(listener, "No secondary display via DisplayManager");

        // ── Path 2: CloudPOS SDK / JNI ──
        log(listener, "Trying CloudPOS SDK...");
        try {
            POSTerminal terminal = POSTerminal.getInstance(context);
            log(listener, "POSTerminal OK");
            for (String name : SDK_DEVICE_NAMES) {
                try {
                    SecondaryDisplayDevice dev =
                            (SecondaryDisplayDevice) terminal.getDevice(name);
                    if (dev != null) {
                        log(listener, "SDK device: \"" + name + "\"");
                        sdkDevice = dev;
                        break;
                    }
                } catch (Exception e) {
                    log(listener, "getDevice(\"" + name + "\") err: " + detail(e));
                }
            }
        } catch (Exception e) {
            log(listener, "POSTerminal err: " + detail(e));
        }

        if (sdkDevice != null) {
            // ── Path 2a: sdkDevice.open(0) + sdkDevice.display() ──
            log(listener, "Trying sdkDevice.open(0) + display()...");
            try {
                sdkDevice.open(0);
                log(listener, "sdkDevice.open(0) OK");
                Bitmap test = Bitmap.createBitmap(10, 10, Bitmap.Config.RGB_565);
                test.eraseColor(Color.WHITE);
                sdkDevice.display(test);
                test.recycle();
                log(listener, "sdkDevice.display() OK");
                mode = Mode.SDK_DEVICE;
                log(listener, "SDK_DEVICE mode ready");
                return;
            } catch (Exception e) {
                log(listener, "sdkDevice approach failed: " + detail(e));
            }

            // ── Path 2b: SecondaryDisplayInterface (JNI static) ──
            log(listener, "Trying SecondaryDisplayInterface...");
            int openResult = SecondaryDisplayInterface.open();
            log(listener, "JNI open()=" + openResult);
            int testResult = SecondaryDisplayInterface.displayDefaultScreen();
            log(listener, "displayDefaultScreen()=" + testResult
                    + (testResult >= 0 ? " OK" : " FAILED"));
            if (testResult >= 0) {
                mode = Mode.CLOUDPOS_JNI;
                log(listener, "CloudPOS JNI mode ready");
            } else {
                log(listener, "CloudPOS JNI not accessible (result=" + testResult + ")");
            }
        }

        if (mode == Mode.NONE) {
            log(listener, "ERROR: No secondary display accessible");
        }
    }

    public boolean isReady() {
        return mode != Mode.NONE;
    }

    public String getStatusText() {
        switch (mode) {
            case PRESENTATION: return "Ready (Presentation: " + secondaryDisplay.getName() + ")";
            case SDK_DEVICE:   return "Ready (SDK Device)";
            case CLOUDPOS_JNI: return "Ready (CloudPOS JNI)";
            default:           return "Not initialized — press Init";
        }
    }

    public String getDiagLog() { return diagLog.toString(); }

    /**
     * Minimal reference test: open(0) → 10x10 red RGB_565 → display().
     * Runs exactly the vendor reference code pattern to isolate permission vs format issues.
     */
    public String testMinimal() {
        if (sdkDevice == null) return "FAIL: no SDK device (press Init first)";
        try {
            sdkDevice.open(0);
        } catch (Exception e) {
            return "open(0) FAIL: " + detail(e);
        }
        try {
            Bitmap bitmap = Bitmap.createBitmap(10, 10, Bitmap.Config.RGB_565);
            bitmap.eraseColor(Color.RED);
            sdkDevice.display(bitmap);
            return "SUCCESS — 10x10 red bitmap displayed";
        } catch (Exception e) {
            return "display() FAIL: " + detail(e);
        }
    }

    /** Cash — show total only, no QR. */
    public void showCash(String price, String currency, String description) throws Exception {
        sendBitmap(renderTextBitmap(description, currency + " " + price,
                "Thank You", Color.BLACK, displayW, displayH));
    }

    /** Card — prompt customer to tap / insert. */
    public void showCard(String price, String currency, String description) throws Exception {
        sendBitmap(renderTextBitmap(description, currency + " " + price,
                "Please Tap / Insert Card", Color.parseColor("#1565C0"), displayW, displayH));
    }

    /** E-Wallet / QR — show QR code. Returns QR bitmap for preview. */
    public Bitmap showWallet(String price, String currency, String description,
                             String qrContent) throws Exception {
        int qrSize = Math.min(displayW - 20, displayH - 90);
        Bitmap qrBitmap = generateQR(qrContent, qrSize);
        sendBitmap(renderDisplayBitmap(price, currency, description, qrBitmap, displayW, displayH));
        return qrBitmap;
    }

    public void clear() {
        try {
            Bitmap blank = Bitmap.createBitmap(displayW, displayH, Bitmap.Config.ARGB_8888);
            blank.eraseColor(Color.WHITE);
            sendBitmap(blank);
        } catch (Exception ignored) {}
    }

    public void close() {
        clear();
        dismissPresentation();
        sdkDevice = null;
        mode = Mode.NONE;
    }

    // -------------------------------------------------------------------------
    // Internal send
    // -------------------------------------------------------------------------

    private void sendBitmap(Bitmap screen) throws Exception {
        if (mode == Mode.NONE) throw new Exception("Display not initialized. Press Init first.");

        if (mode == Mode.SDK_DEVICE) {
            try {
                sdkDevice.display(screen);
            } catch (Exception e) {
                // Device may need re-opening after idle; try once more
                try {
                    sdkDevice.open(0);
                    sdkDevice.display(screen);
                } catch (Exception e2) {
                    throw new Exception("sdkDevice.display() failed: " + detail(e2));
                }
            }
        } else if (mode == Mode.PRESENTATION) {
            // Presentation.show() must run on UI thread; block until done
            final Exception[] err = {null};
            CountDownLatch latch = new CountDownLatch(1);
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    if (currentPresentation != null && currentPresentation.isShowing()) {
                        currentPresentation.dismiss();
                    }
                    currentPresentation = new DisplayPresentation(context, secondaryDisplay, screen);
                    currentPresentation.show();
                } catch (Exception e) {
                    err[0] = e;
                } finally {
                    latch.countDown();
                }
            });
            latch.await(3, TimeUnit.SECONDS);
            if (err[0] != null) throw new Exception("Presentation failed: " + err[0].getMessage());

        } else {
            // CloudPOS JNI path
            int w = screen.getWidth();
            int h = screen.getHeight();
            Bitmap rgb565 = screen.copy(Bitmap.Config.RGB_565, false);
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.allocate(w * h * 2);
            rgb565.copyPixelsToBuffer(buf);
            rgb565.recycle();
            buf.flip();
            byte[] pixels = buf.array();
            int result = SecondaryDisplayInterface.writePicture(0, 0, w, h, pixels, pixels.length);
            if (result < 0) throw new Exception("writePicture() failed: result=" + result
                    + " size=" + w + "x" + h);
        }
    }

    private void dismissPresentation() {
        if (currentPresentation != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try { currentPresentation.dismiss(); } catch (Exception ignored) {}
                currentPresentation = null;
            });
        }
    }

    // -------------------------------------------------------------------------
    // Presentation inner class
    // -------------------------------------------------------------------------

    private static class DisplayPresentation extends Presentation {
        private final Bitmap bitmap;

        DisplayPresentation(Context context, Display display, Bitmap bitmap) {
            super(context, display);
            this.bitmap = bitmap;
            getWindow().setBackgroundDrawableResource(android.R.color.white);
        }

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            ImageView iv = new ImageView(getContext());
            iv.setImageBitmap(bitmap);
            iv.setScaleType(ImageView.ScaleType.FIT_XY);
            iv.setBackgroundColor(Color.WHITE);
            setContentView(iv);
        }
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    public static Bitmap renderTextBitmap(String description, String amount,
                                          String instruction, int instructionColor, int w, int h) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);

        Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        titlePaint.setColor(Color.BLACK);
        titlePaint.setTextSize(20f);
        titlePaint.setFakeBoldText(true);

        Paint amountPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        amountPaint.setColor(Color.BLACK);
        amountPaint.setTextSize(26f);
        amountPaint.setFakeBoldText(true);

        Paint instrPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        instrPaint.setColor(instructionColor);
        instrPaint.setTextSize(18f);

        String desc = (description != null && !description.isEmpty()) ? description : "ABC STORE";
        canvas.drawText(desc,        centeredX(desc,        titlePaint,  w), 40,  titlePaint);
        canvas.drawText(amount,      centeredX(amount,      amountPaint, w), 80,  amountPaint);
        canvas.drawText(instruction, centeredX(instruction, instrPaint,  w), 130, instrPaint);
        return bmp;
    }

    public static Bitmap renderDisplayBitmap(String price, String currency,
            String description, Bitmap qrBitmap, int w, int h) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);

        Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        titlePaint.setColor(Color.BLACK);
        titlePaint.setTextSize(20f);
        titlePaint.setFakeBoldText(true);

        Paint amountPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        amountPaint.setColor(Color.BLACK);
        amountPaint.setTextSize(24f);
        amountPaint.setFakeBoldText(true);

        String desc = (description != null && !description.isEmpty()) ? description : "ABC STORE";
        String amountStr = currency + " " + price;
        canvas.drawText(desc,      centeredX(desc,      titlePaint,  w), 30, titlePaint);
        canvas.drawText(amountStr, centeredX(amountStr, amountPaint, w), 60, amountPaint);

        if (qrBitmap != null) {
            float qrX = (w - qrBitmap.getWidth()) / 2f;
            canvas.drawBitmap(qrBitmap, qrX, 80, null);
        }
        return bmp;
    }

    public static Bitmap generateQR(String content, int size) throws WriterException {
        BitMatrix matrix = new QRCodeWriter()
                .encode(content, BarcodeFormat.QR_CODE, size, size);
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        for (int x = 0; x < size; x++)
            for (int y = 0; y < size; y++)
                bmp.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
        return bmp;
    }

    private static float centeredX(String text, Paint paint, int w) {
        return (w - paint.measureText(text)) / 2f;
    }

    private String displaySizeOf(Display d) {
        android.graphics.Point size = new android.graphics.Point();
        d.getSize(size);
        return size.x + "x" + size.y;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void log(LogListener listener, String msg) {
        diagLog.append(msg).append("\n");
        if (listener != null) listener.onLog(msg);
    }

    private static String detail(Throwable t) {
        if (t == null) return "null";
        for (String m : new String[]{"getErrCode", "getErrcode", "getErrorCode", "getCode"}) {
            try {
                java.lang.reflect.Method method = t.getClass().getMethod(m);
                Object code = method.invoke(t);
                return t.getClass().getSimpleName() + "[code=" + code + "]: " + t.getMessage();
            } catch (Exception ignored) {}
        }
        return t.getClass().getSimpleName() + ": " + t.getMessage();
    }
}
