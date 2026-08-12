package com.yourcompany.pos;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.ImageView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

public class PaymentTestActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {

        super.onCreate(savedInstanceState);

        setContentView(R.layout.activity_payment_test);

        ImageView imgQR = findViewById(R.id.imgQR);

        try {

            Bitmap bitmap =
                    generateQRCode(
                            "https://duitnow.my/test",
                            300,
                            300);

            imgQR.setImageBitmap(bitmap);

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private Bitmap generateQRCode(
            String text,
            int width,
            int height) throws Exception {

        BitMatrix bitMatrix =
                new MultiFormatWriter().encode(
                        text,
                        BarcodeFormat.QR_CODE,
                        width,
                        height);

        Bitmap bitmap =
                Bitmap.createBitmap(
                        width,
                        height,
                        Bitmap.Config.ARGB_8888);

        for (int x = 0; x < width; x++) {

            for (int y = 0; y < height; y++) {

                bitmap.setPixel(
                        x,
                        y,
                        bitMatrix.get(x, y)
                                ? Color.BLACK
                                : Color.WHITE);
            }
        }

        return bitmap;
    }
}
