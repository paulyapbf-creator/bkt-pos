package com.example.printerdemo;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;


import android.content.SharedPreferences;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import com.google.android.material.tabs.TabLayout;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintWriter;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.Collections;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "PrinterTest";
    private static final int DEFAULT_SERVER_PORT = 8888;

    // Printer
    private WizarPosPrinter printer;
    private TextView tvStatus;
    private TextView tvLog;
    private ScrollView scrollLog;

    // Customer Display
    static CustomerDisplayManager customerDisplay;
    private TextView tvDisplayStatus;
    private EditText etDescription;
    private EditText etCurrency;
    private EditText etPrice;
    private ImageView ivQRPreview;

    // Cashier
    private EditText etCashierCurrency;
    private EditText etCashierAmount;
    private EditText etCashierDesc;
    private TextView tvCashierStatus;
    private ImageView imgQR;

    // eWallet (App2App)
    private EditText etEWalletAmount;
    private EditText etEWalletId;
    private EditText etEWalletOrderId;
    private EditText etEWalletPkgName;
    private EditText etEWalletClassName;
    private EditText etEWalletIndexM;
    private EditText etEWalletIndexT;
    private TextView tvEWalletStatus;
    private TextView tvEWalletPass;
    private TextView tvEWalletFail;
    static int eWalletPassCount = 0;
    static int eWalletFailCount = 0;
    static String eWalletLastResult = "";

    // Terminal / Sale tab
    private EditText etTerminalPkgName;
    private EditText etTerminalClassName;
    private EditText etTerminalIndexM;
    private EditText etTerminalIndexT;
    private EditText etTerminalAmount;
    private EditText etTerminalOrderId;
    private TextView tvTerminalStatus;
    private TextView tvTerminalPass;
    private TextView tvTerminalFail;
    private android.widget.ListView lvTerminalResponses;
    private ArrayAdapter<String> terminalResponseAdapter;
    static String terminalLastRequest = "";
    static final java.util.ArrayList<String> terminalResponses = new java.util.ArrayList<>();
    static final java.util.ArrayList<String> terminalResponseDetails = new java.util.ArrayList<>();
    static int terminalPassCount = 0;
    static int terminalFailCount = 0;
    private static int sqn = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final StringBuilder logBuffer = new StringBuilder();

    private String lastHostIp = "";
    private SharedPreferences prefs;
    private File logFile;
    private PrintWriter logWriter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // --- Printer tab views ---
        tvStatus  = findViewById(R.id.tvStatus);
        tvLog     = findViewById(R.id.tvLog);
        scrollLog = findViewById(R.id.scrollLog);
        Button btnInit    = findViewById(R.id.btnInit);
        Button btnText    = findViewById(R.id.btnText);
        Button btnImage   = findViewById(R.id.btnImage);
        Button btnTestAll = findViewById(R.id.btnTestAll);
        Button btnCutPaper = findViewById(R.id.btnCutPaper);
        Button btnDiag    = findViewById(R.id.btnDiag);
        Button btnCopy    = findViewById(R.id.btnCopy);
        Button btnShare   = findViewById(R.id.btnShare);
        Button btnUpdate  = findViewById(R.id.btnUpdate);

        // --- Customer Display tab views ---
        tvDisplayStatus = findViewById(R.id.tvDisplayStatus);
        etDescription   = findViewById(R.id.etDescription);
        etCurrency      = findViewById(R.id.etCurrency);
        etPrice         = findViewById(R.id.etPrice);
        ivQRPreview     = findViewById(R.id.ivQRPreview);
        Button btnShowDisplay  = findViewById(R.id.btnShowDisplay);
        Button btnClearDisplay = findViewById(R.id.btnClearDisplay);

        // --- eWallet tab views ---
        etEWalletAmount    = findViewById(R.id.etEWalletAmount);
        etEWalletId        = findViewById(R.id.etEWalletId);
        etEWalletOrderId   = findViewById(R.id.etEWalletOrderId);
        etEWalletPkgName   = findViewById(R.id.etEWalletPkgName);
        etEWalletClassName = findViewById(R.id.etEWalletClassName);
        etEWalletIndexM    = findViewById(R.id.etEWalletIndexM);
        etEWalletIndexT    = findViewById(R.id.etEWalletIndexT);
        tvEWalletStatus    = findViewById(R.id.tvEWalletStatus);
        tvEWalletPass      = findViewById(R.id.tvEWalletPass);
        tvEWalletFail      = findViewById(R.id.tvEWalletFail);
        tvEWalletPass.setText(String.valueOf(eWalletPassCount));
        tvEWalletFail.setText(String.valueOf(eWalletFailCount));
        findViewById(R.id.btnEWalletSale).setOnClickListener(v -> launchEWallet(false));
        findViewById(R.id.btnEWalletQR).setOnClickListener(v -> launchEWallet(true));
        findViewById(R.id.btnEWalletIdS95).setOnClickListener(v -> etEWalletId.setText("S95"));
        findViewById(R.id.btnEWalletIdDuitNow).setOnClickListener(v -> etEWalletId.setText("DuitNow"));
        findViewById(R.id.btnEWalletIdTnG).setOnClickListener(v -> etEWalletId.setText("TnG"));
        findViewById(R.id.btnEWalletIdBoost).setOnClickListener(v -> etEWalletId.setText("Boost"));
        findViewById(R.id.btnEWalletIdShopeePay).setOnClickListener(v -> etEWalletId.setText("ShopeePay"));
        findViewById(R.id.btnEWalletIdGrabPay).setOnClickListener(v -> etEWalletId.setText("GrabPay"));
        findViewById(R.id.btnEWalletIdMAE).setOnClickListener(v -> etEWalletId.setText("MAE"));
        findViewById(R.id.btnEWalletIdClear).setOnClickListener(v -> etEWalletId.setText(""));

        // --- Cashier tab views ---
        etCashierCurrency = findViewById(R.id.etCashierCurrency);
        etCashierAmount   = findViewById(R.id.etCashierAmount);
        etCashierDesc     = findViewById(R.id.etCashierDesc);
        tvCashierStatus   = findViewById(R.id.tvCashierStatus);
        imgQR             = findViewById(R.id.imgQR);
        Button btnPayCash   = findViewById(R.id.btnPayCash);
        Button btnPayCard   = findViewById(R.id.btnPayCard);
        Button btnPayWallet = findViewById(R.id.btnPayWallet);

        // --- Terminal / Sale tab views ---
        etTerminalPkgName   = findViewById(R.id.etTerminalPkgName);
        etTerminalClassName = findViewById(R.id.etTerminalClassName);
        etTerminalIndexM    = findViewById(R.id.etTerminalIndexM);
        etTerminalIndexT    = findViewById(R.id.etTerminalIndexT);
        etTerminalAmount    = findViewById(R.id.etTerminalAmount);
        etTerminalOrderId   = findViewById(R.id.etTerminalOrderId);
        tvTerminalStatus    = findViewById(R.id.tvTerminalStatus);
        tvTerminalPass      = findViewById(R.id.tvTerminalPass);
        tvTerminalFail      = findViewById(R.id.tvTerminalFail);
        lvTerminalResponses = findViewById(R.id.lvTerminalResponses);
        tvTerminalPass.setText(String.valueOf(terminalPassCount));
        tvTerminalFail.setText(String.valueOf(terminalFailCount));
        terminalResponseAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_list_item_1, terminalResponses);
        lvTerminalResponses.setAdapter(terminalResponseAdapter);
        lvTerminalResponses.setEmptyView(findViewById(R.id.tvTerminalEmpty));
        lvTerminalResponses.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < terminalResponseDetails.size()) {
                showTerminalDetail(terminalResponseDetails.get(position));
            }
        });
        terminalResponseAdapter.notifyDataSetChanged();
        findViewById(R.id.btnTerminalSale).setOnClickListener(v -> launchSale());
        findViewById(R.id.btnScanTerminal).setOnClickListener(v -> scanForTerminal());


        // --- Tab panels ---
        LinearLayout tabPrinter         = findViewById(R.id.tabPrinter);
        LinearLayout tabCustomerDisplay = findViewById(R.id.tabCustomerDisplay);
        android.widget.ScrollView tabWallet = findViewById(R.id.tabWallet);
        LinearLayout tabCashier         = findViewById(R.id.tabCashier);
        LinearLayout tabMaintain              = findViewById(R.id.tabMaintain);
        LinearLayout tabTerminal = findViewById(R.id.tabTerminal);

        prefs = getSharedPreferences("printer_test", MODE_PRIVATE);
        lastHostIp = prefs.getString("last_host_ip", "");
        initLogFile();

        printer = new WizarPosPrinter();
        customerDisplay = new CustomerDisplayManager(this);

        // --- Printer tab listeners ---
        btnInit.setOnClickListener(v -> runOnThread(this::initPrinter));
        btnText.setOnClickListener(v -> runOnThread(this::printTextDemo));
        btnImage.setOnClickListener(v -> runOnThread(this::printImageDemo));
        btnTestAll.setOnClickListener(v -> runOnThread(this::printAllTests));
        btnCutPaper.setOnClickListener(v -> runOnThread(this::feedAndCut));
        btnDiag.setOnClickListener(v -> showDiagnostics());
        btnCopy.setOnClickListener(v -> copyLog());
        btnShare.setOnClickListener(v -> shareLog());
        btnUpdate.setOnClickListener(v -> showUpdateDialog());

        // --- Customer Display tab listeners ---
        btnShowDisplay.setOnClickListener(v -> showOnCustomerDisplay());
        btnClearDisplay.setOnClickListener(v -> clearCustomerDisplay());

        Button btnInitDisplay = findViewById(R.id.btnInitDisplay);
        btnInitDisplay.setOnClickListener(v -> runOnThread(this::initCustomerDisplay));

        Button btnTestDisplay = findViewById(R.id.btnTestDisplay);
        btnTestDisplay.setOnClickListener(v -> runOnThread(() -> {
            String result = customerDisplay.testMinimal();
            appendLog("[DISPLAY TEST] " + result);
            mainHandler.post(() -> tvDisplayStatus.setText(result));
        }));

        // --- Cashier tab listeners ---
        btnPayCash.setOnClickListener(v   -> onPaymentSelected("CASH"));
        btnPayCard.setOnClickListener(v   -> onPaymentSelected("CARD"));
        btnPayWallet.setOnClickListener(v -> onPaymentSelected("WALLET"));

        // --- Tab switching ---
        TabLayout tabLayout = findViewById(R.id.tabLayout);
        tabLayout.addTab(tabLayout.newTab().setText("Printer"));
        tabLayout.addTab(tabLayout.newTab().setText("Maintain"));
        tabLayout.addTab(tabLayout.newTab().setText("Display"));
        tabLayout.addTab(tabLayout.newTab().setText("Wallet"));
        tabLayout.addTab(tabLayout.newTab().setText("Cashier"));
        tabLayout.addTab(tabLayout.newTab().setText("Terminal"));
        tabLayout.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                tabPrinter.setVisibility(View.GONE);
                tabMaintain.setVisibility(View.GONE);
                tabCustomerDisplay.setVisibility(View.GONE);
                tabWallet.setVisibility(View.GONE);
                tabCashier.setVisibility(View.GONE);
                tabTerminal.setVisibility(View.GONE);
                switch (tab.getPosition()) {
                    case 0: tabPrinter.setVisibility(View.VISIBLE); break;
                    case 1: tabMaintain.setVisibility(View.VISIBLE); break;
                    case 2:
                        tabCustomerDisplay.setVisibility(View.VISIBLE);
                        refreshDisplayStatus();
                        break;
                    case 3:
                        tabWallet.setVisibility(View.VISIBLE);
                        tvEWalletPass.setText(String.valueOf(eWalletPassCount));
                        tvEWalletFail.setText(String.valueOf(eWalletFailCount));
                        if (!eWalletLastResult.isEmpty()) {
                            tvEWalletStatus.setText(eWalletLastResult);
                        }
                        break;
                    case 4: tabCashier.setVisibility(View.VISIBLE); break;
                    case 5:
                        tabTerminal.setVisibility(View.VISIBLE);
                        tvTerminalPass.setText(String.valueOf(terminalPassCount));
                        tvTerminalFail.setText(String.valueOf(terminalFailCount));
                        terminalResponseAdapter.notifyDataSetChanged();
                        break;
                }
            }
            @Override public void onTabUnselected(TabLayout.Tab tab) {}
            @Override public void onTabReselected(TabLayout.Tab tab) {}
        });
    }

    // ---- Customer Display ----

    private void refreshDisplayStatus() {
        tvDisplayStatus.setText("Display status: " + customerDisplay.getStatusText());
    }

    private void initCustomerDisplay() {
        mainHandler.post(() -> tvDisplayStatus.setText("Initializing display..."));
        customerDisplay.init(msg -> appendLog("[DISPLAY] " + msg));
        mainHandler.post(() -> {
            if (customerDisplay.isReady()) {
                tvDisplayStatus.setText("Ready: " + customerDisplay.getStatusText());
            } else {
                tvDisplayStatus.setText(
                    "Secondary display not accessible.\n\n" +
                    "The WizarPOS Q2 Pro customer display requires platform signing.\n" +
                    "Contact WizarPOS/SHWP to sign this APK with the platform key,\n" +
                    "or ask them to whitelist package: " + getPackageName());
            }
        });
    }

    private void showOnCustomerDisplay() {
        String price = etPrice.getText().toString().trim();
        String currency = etCurrency.getText().toString().trim();
        String description = etDescription.getText().toString().trim();

        if (price.isEmpty()) {
            Toast.makeText(this, "Enter a price first", Toast.LENGTH_SHORT).show();
            return;
        }
        if (currency.isEmpty()) currency = "THB";

        final String finalCurrency = currency;
        final String finalPrice = price;
        final String finalDesc = description;

        runOnThread(() -> {
            try {
                Bitmap preview = CustomerDisplayManager.generateQR(finalCurrency + " " + finalPrice, 400);
                mainHandler.post(() -> ivQRPreview.setImageBitmap(preview));

                customerDisplay.showWallet(finalPrice, finalCurrency, finalDesc,
                        finalCurrency + " " + finalPrice);
                mainHandler.post(() -> tvDisplayStatus.setText("Showing: " + finalCurrency + " " + finalPrice));
            } catch (Exception e) {
                mainHandler.post(() -> {
                    tvDisplayStatus.setText("Error: " + e.getMessage());
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void clearCustomerDisplay() {
        runOnThread(() -> {
            customerDisplay.clear();
            mainHandler.post(() -> {
                ivQRPreview.setImageBitmap(null);
                refreshDisplayStatus();
            });
        });
    }

    // ---- eWallet (App2App) ----

    private void launchEWallet(boolean useQR) {
        String pkgName   = etEWalletPkgName.getText().toString().trim();
        String clsName   = etEWalletClassName.getText().toString().trim();
        String amount    = etEWalletAmount.getText().toString().trim();
        String eWalletId = etEWalletId.getText().toString().trim();
        String orderId   = etEWalletOrderId.getText().toString().trim();
        int    indexM    = parseIndex(etEWalletIndexM, 1);
        int    indexT    = parseIndex(etEWalletIndexT, 1);

        if (amount.isEmpty()) {
            Toast.makeText(this, "Enter amount", Toast.LENGTH_SHORT).show();
            return;
        }

        try {
            amount = String.format(Locale.US, "%.2f", Double.parseDouble(amount));
        } catch (NumberFormatException e) {
            tvEWalletStatus.setText("Invalid amount: " + amount);
            tvEWalletStatus.setBackgroundColor(0xFFFFCDD2);
            return;
        }

        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage(pkgName);
            if (intent == null) {
                for (String[] pair : KNOWN_TERMINALS) {
                    Intent probe = getPackageManager().getLaunchIntentForPackage(pair[0]);
                    if (probe != null) {
                        pkgName = pair[0];
                        clsName = pair[1];
                        intent  = probe;
                        etEWalletPkgName.setText(pkgName);
                        etEWalletClassName.setText(clsName);
                        appendLog("[EWALLET] Auto-detected: " + pkgName);
                        break;
                    }
                }
            }
            if (intent == null) {
                appendLog("[EWALLET] No terminal installed — switching to simulator");
                tvEWalletStatus.setText("Terminal not found — simulating");
                tvEWalletStatus.setBackgroundColor(0xFFFFF9C4);
                eWalletLastResult = "";
                final String finalAmt = amount;
                new AlertDialog.Builder(this)
                        .setTitle("Terminal not installed")
                        .setMessage("Simulate eWallet payment for amount: " + finalAmt)
                        .setPositiveButton("Simulate Approved",
                                (d, w) -> simulateEWalletPayment(finalAmt, true))
                        .setNegativeButton("Simulate Failed",
                                (d, w) -> simulateEWalletPayment(finalAmt, false))
                        .setNeutralButton("Cancel", null)
                        .show();
                return;
            }

            intent.setAction(Intent.ACTION_SENDTO);
            intent.setClassName(pkgName, pkgName + clsName);
            intent.setType("text/plain");
            intent.putExtra("typeofSale", 66);
            intent.putExtra("Value_1", amount);
            intent.putExtra("sqn", getSQN());
            intent.putExtra("indexM", indexM);
            intent.putExtra("indexT", indexT);
            if (useQR) {
                // Always include eWalletId for QR mode (even if empty), matching App2App
                intent.putExtra("eWalletId", eWalletId);
            }
            if (!orderId.isEmpty()) {
                intent.putExtra("orderId", orderId);
            }
            intent.putExtra("ClassName",   "com.example.printerdemo.PaymentResultActivity");
            intent.putExtra("PackageName", "com.example.printerdemo");

            terminalLastRequest = buildSaleRequestDetails(intent);
            String mode = useQR ? "E-Wallet QR" : "E-Wallet";
            appendLog("[EWALLET] " + mode + " launched pkg=" + pkgName + " amt=" + amount);
            tvEWalletStatus.setText("Launched: " + mode + "  amt=" + amount
                    + "\n→ " + pkgName);
            tvEWalletStatus.setBackgroundColor(0xFFE3F2FD);
            eWalletLastResult = "";

            final String displayAmt = amount;
            runOnThread(() -> {
                try { customerDisplay.showWallet(displayAmt, "RM", "eWallet Payment",
                        "eWallet " + displayAmt); }
                catch (Exception ignored) {}
            });

            startActivity(intent);
        } catch (Exception e) {
            String msg = "Launch failed: " + e.getMessage();
            tvEWalletStatus.setText(msg);
            tvEWalletStatus.setBackgroundColor(0xFFFFCDD2);
            appendLog("[EWALLET] ERROR: " + msg);
        }
    }

    private int parseIndex(EditText et, int fallback) {
        try { return Integer.parseInt(et.getText().toString().trim()); }
        catch (NumberFormatException e) { return fallback; }
    }

    private void simulateEWalletPayment(String amount, boolean approved) {
        String orderId = etEWalletOrderId.getText().toString().trim();
        Intent result = new Intent(this, PaymentResultActivity.class);
        result.putExtra("typeofSale", 66);
        result.putExtra("Value_1", approved ? "00" : "01");
        result.putExtra("Value_2", approved ? "APPROVED" : "DECLINED");
        result.putExtra("Value_3", amount);
        if (!orderId.isEmpty()) result.putExtra("orderId", orderId);
        tvEWalletStatus.setText("Simulated: eWallet  amt=" + amount);
        tvEWalletStatus.setBackgroundColor(0xFFE3F2FD);
        appendLog("[EWALLET] Simulated eWallet amt=" + amount
                + " approved=" + approved);
        startActivity(result);
    }

    private void scanForTerminal() {
        tvTerminalStatus.setText("Scanning installed packages...");
        tvTerminalStatus.setBackgroundColor(0xFFE3F2FD);

        runOnThread(() -> {
            java.util.List<android.content.pm.PackageInfo> packages =
                    getPackageManager().getInstalledPackages(0);
            java.util.List<String> found = new java.util.ArrayList<>();
            String[] keywords = {"coherent", "terminal", "payment", "centerm", "cpta", "pos"};
            for (android.content.pm.PackageInfo pi : packages) {
                String pkg = pi.packageName.toLowerCase();
                if (pkg.equals(getPackageName().toLowerCase())) continue;
                for (String kw : keywords) {
                    if (pkg.contains(kw)) { found.add(pi.packageName); break; }
                }
            }
            mainHandler.post(() -> {
                if (found.isEmpty()) {
                    tvTerminalStatus.setText("No matching packages found");
                    tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
                    appendLog("[TERMINAL] Scan: no matching packages");
                    return;
                }
                String[] items = found.toArray(new String[0]);
                appendLog("[TERMINAL] Scan found: " + found);

                // Build display list showing package + main activity
                String[] labels = new String[items.length];
                for (int i = 0; i < items.length; i++) {
                    try {
                        android.content.pm.PackageInfo pi =
                                getPackageManager().getPackageInfo(items[i],
                                        android.content.pm.PackageManager.GET_ACTIVITIES);
                        String mainAct = (pi.activities != null && pi.activities.length > 0)
                                ? pi.activities[0].name : "(unknown)";
                        // strip package prefix for readability
                        if (mainAct.startsWith(items[i]))
                            mainAct = mainAct.substring(items[i].length());
                        labels[i] = items[i] + "\n  → " + mainAct;
                        appendLog("[TERMINAL] " + items[i] + " main=" + mainAct);
                    } catch (Exception e) {
                        labels[i] = items[i];
                    }
                }
                final String[] pkgList = items;
                new AlertDialog.Builder(this)
                        .setTitle("Select Terminal Package")
                        .setItems(labels, (d, which) -> {
                            // Parse class from label
                            String label = labels[which];
                            String cls = ".BroadcastTransactionActivity";
                            int arrow = label.indexOf("→ ");
                            if (arrow >= 0) cls = label.substring(arrow + 2).trim();
                            etTerminalPkgName.setText(pkgList[which]);
                            etTerminalClassName.setText(cls);
                            tvTerminalStatus.setText("Selected: " + pkgList[which]);
                            tvTerminalStatus.setBackgroundColor(0xFFE3F2FD);
                        })
                        .setNegativeButton("Cancel", null)
                        .show();
            });
        });
    }

    // Known Coherent terminal package / class pairs (tried in order)
    private static final String[][] KNOWN_TERMINALS = {
        {"com.coherent.centerm.cptpaterminal", ".BroadcastTransactionActivity"},
        {"com.coherent.umobile_terminal",      ".ReceiveSale"},
        {"com.coherent.terminal",              ".BroadcastTransactionActivity"},
        {"com.coherent.pos",                   ".BroadcastTransactionActivity"},
    };

    // ---- Terminal / Sale ----

    private void launchSale() {
        String pkgName = etTerminalPkgName.getText().toString().trim();
        String clsName = etTerminalClassName.getText().toString().trim();
        int    indexM  = parseIndex(etTerminalIndexM, 1);
        int    indexT  = parseIndex(etTerminalIndexT, 1);
        String amount  = etTerminalAmount.getText().toString().trim();
        String orderId = etTerminalOrderId.getText().toString().trim();

        if (amount.isEmpty()) {
            tvTerminalStatus.setText("Enter amount");
            tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
            Toast.makeText(this, "Enter amount", Toast.LENGTH_SHORT).show();
            return;
        }

        // Ensure decimal format — terminal requires e.g. "0.10" not "10"
        try {
            amount = String.format(Locale.US, "%.2f", Double.parseDouble(amount));
        } catch (NumberFormatException e) {
            tvTerminalStatus.setText("Invalid amount: " + amount);
            tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
            return;
        }

        try {
            // If user left fields at defaults, auto-detect installed terminal
            Intent intent = getPackageManager().getLaunchIntentForPackage(pkgName);
            if (intent == null) {
                for (String[] pair : KNOWN_TERMINALS) {
                    Intent probe = getPackageManager().getLaunchIntentForPackage(pair[0]);
                    if (probe != null) {
                        pkgName = pair[0];
                        clsName = pair[1];
                        intent  = probe;
                        etTerminalPkgName.setText(pkgName);
                        etTerminalClassName.setText(clsName);
                        appendLog("[TERMINAL] Auto-detected: " + pkgName);
                        break;
                    }
                }
            }
            if (intent == null) {
                appendLog("[TERMINAL] No terminal installed");
                tvTerminalStatus.setText("Terminal not found — install terminal app");
                tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
                return;
            }
            intent.setAction(Intent.ACTION_SENDTO);
            intent.setClassName(pkgName, pkgName + clsName);
            intent.setType("text/plain");
            intent.putExtra("typeofSale", 1);
            intent.putExtra("Value_1", amount);
            intent.putExtra("sqn", getSQN());
            intent.putExtra("indexM", indexM);
            intent.putExtra("indexT", indexT);
            if (!orderId.isEmpty()) intent.putExtra("orderId", orderId);
            intent.putExtra("ClassName",   "com.example.printerdemo.PaymentResultActivity");
            intent.putExtra("PackageName", "com.example.printerdemo");

            terminalLastRequest = buildSaleRequestDetails(intent);
            appendLog("[TERMINAL] SALE launched pkg=" + pkgName + " amt=" + amount);
            tvTerminalStatus.setText("Launched: SALE  amt=" + amount);
            tvTerminalStatus.setBackgroundColor(0xFFE3F2FD);

            // Activate customer display: show amount while terminal processes
            final String displayAmt = amount;
            runOnThread(() -> {
                try { customerDisplay.showCard(displayAmt, "RM", "Card Payment"); }
                catch (Exception ignored) {}
            });

            startActivity(intent);

        } catch (Exception e) {
            String msg = "Launch failed: " + e.getMessage();
            tvTerminalStatus.setText(msg);
            tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
            appendLog("[TERMINAL] ERROR: " + msg);
        }
    }

    private String buildSaleRequestDetails(Intent intent) {
        android.os.Bundle b = intent.getExtras();
        if (b == null) return "No request extras.";
        StringBuilder sb = new StringBuilder();
        String[] keys = {"typeofSale","Value_1","sqn","indexM","indexT","orderId",
                         "ClassName","PackageName"};
        for (String key : keys) {
            if (!b.containsKey(key)) continue;
            if (sb.length() > 0) sb.append("\n");
            sb.append(key).append(" : ").append(b.get(key));
        }
        return sb.toString();
    }

    private void showTerminalDetail(String details) {
        android.widget.ScrollView sv = new android.widget.ScrollView(this);
        TextView tv = new TextView(this);
        int p = (int)(12 * getResources().getDisplayMetrics().density);
        tv.setPadding(p, p, p, p);
        tv.setText(details);
        tv.setTextSize(13f);
        tv.setTextIsSelectable(true);
        sv.addView(tv);
        new AlertDialog.Builder(this)
                .setTitle("Response Details")
                .setView(sv)
                .setPositiveButton("Close", null)
                .show();
    }

    private String getSQN() {
        if (sqn > 99) sqn = 0;
        String s = Integer.toString(sqn++);
        return s.length() == 1 ? "0" + s : s;
    }

    // ---- Cashier ----

    private void onPaymentSelected(String method) {
        String amount = etCashierAmount.getText().toString().trim();
        if (amount.isEmpty()) {
            Toast.makeText(this, "Enter amount first", Toast.LENGTH_SHORT).show();
            return;
        }
        String currency = etCashierCurrency.getText().toString().trim();
        if (currency.isEmpty()) currency = "RM";
        String desc = etCashierDesc.getText().toString().trim();

        final String finalCurrency = currency;
        final String finalAmount   = amount;
        final String finalDesc     = desc;

        if (!customerDisplay.isReady()) {
            tvCashierStatus.setText("Secondary display not accessible — requires platform signing.\n" +
                "Contact WizarPOS/SHWP to enable for package: " + getPackageName());
            return;
        }
        imgQR.setVisibility(View.GONE);
        tvCashierStatus.setText("Processing " + method + "...");

        runOnThread(() -> {
            try {
                switch (method) {
                    case "CASH":
                        // Secondary display: show total — no QR
                        customerDisplay.showCash(finalAmount, finalCurrency, finalDesc);
                        mainHandler.post(() -> {
                            tvCashierStatus.setText("Cash — total shown on customer display");
                            imgQR.setVisibility(View.GONE);
                        });
                        break;

                    case "CARD":
                        try { customerDisplay.showCard(finalAmount, finalCurrency, finalDesc); } catch (Exception ignored) {}
                        mainHandler.post(() -> {
                            tvCashierStatus.setText("Card — use Terminal tab to process payment");
                            imgQR.setVisibility(View.GONE);
                        });
                        break;

                    case "WALLET":
                        // Secondary display: show QR for customer to scan
                        String qrContent = "https://duitnow.my/pay?amount=" + finalAmount;
                        Bitmap qr = customerDisplay.showWallet(
                                finalAmount, finalCurrency, finalDesc, qrContent);
                        mainHandler.post(() -> {
                            tvCashierStatus.setText("E-Wallet — QR shown on customer display");
                            imgQR.setImageBitmap(qr);
                            imgQR.setVisibility(View.VISIBLE);
                        });
                        break;
                }
            } catch (Exception e) {
                mainHandler.post(() -> tvCashierStatus.setText("Error: " + e.getMessage()));
            }
        });
    }

    // ---- Update APK ----

    private void showUpdateDialog() {
        EditText input = new EditText(this);
        input.setHint("192.168.1.100");
        if (!lastHostIp.isEmpty()) {
            input.setText(lastHostIp);
        }
        input.setSelection(input.getText().length());

        String deviceIp = getDeviceIp();

        new AlertDialog.Builder(this)
            .setTitle("Update APK from PC")
            .setMessage("Device IP: " + deviceIp
                + "\nEnter PC IP (serve_apk.py on port " + DEFAULT_SERVER_PORT + ")"
                + "\nOr wait for auto-detect...")
            .setView(input)
            .setPositiveButton("Update", (dialog, which) -> {
                String ip = input.getText().toString().trim();
                if (!ip.isEmpty()) {
                    saveHostIp(ip);
                    runOnThread(() -> downloadAndInstall(ip));
                }
            })
            .setNeutralButton("Auto-detect", (dialog, which) -> {
                runOnThread(this::autoDetectAndUpdate);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void autoDetectAndUpdate() {
        appendLog("--- Auto-detecting PC ---");
        setStatus("Scanning for PC server...");

        try {
            DatagramSocket socket = new DatagramSocket(8889);
            socket.setSoTimeout(5000);
            byte[] buf = new byte[256];
            DatagramPacket packet = new DatagramPacket(buf, buf.length);
            socket.receive(packet);
            String msg = new String(packet.getData(), 0, packet.getLength()).trim();
            socket.close();

            if (msg.startsWith("WIZARPOS_DEV_SERVER:")) {
                String ip = msg.substring("WIZARPOS_DEV_SERVER:".length());
                appendLog("Found PC at " + ip);
                saveHostIp(ip);
                downloadAndInstall(ip);
                return;
            }
        } catch (Exception e) {
            appendLog("UDP beacon not found, scanning subnet...");
        }

        String deviceIp = getDeviceIp();
        if (deviceIp.equals("unknown")) {
            appendLog("Cannot detect device IP");
            setStatus("Auto-detect failed");
            return;
        }

        String subnet = deviceIp.substring(0, deviceIp.lastIndexOf('.') + 1);
        appendLog("Scanning " + subnet + "x port " + DEFAULT_SERVER_PORT);

        for (int i = 1; i <= 254; i++) {
            String testIp = subnet + i;
            if (testIp.equals(deviceIp)) continue;
            try {
                URL url = new URL("http://" + testIp + ":" + DEFAULT_SERVER_PORT + "/ping");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(200);
                conn.setReadTimeout(200);
                int code = conn.getResponseCode();
                conn.disconnect();
                if (code == 200) {
                    appendLog("Found PC at " + testIp);
                    saveHostIp(testIp);
                    setStatus("Found PC: " + testIp);
                    downloadAndInstall(testIp);
                    return;
                }
            } catch (Exception ignored) {}
        }

        appendLog("No PC server found on subnet");
        setStatus("Auto-detect failed - enter IP manually");
    }

    private String getDeviceIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    String ip = addr.getHostAddress();
                    if (ip != null && ip.indexOf(':') < 0 && !ip.startsWith("127.")) {
                        return ip;
                    }
                }
            }
        } catch (Exception ignored) {}
        return "unknown";
    }

    private void downloadAndInstall(String hostIp) {
        String apkUrl = "http://" + hostIp + ":" + DEFAULT_SERVER_PORT + "/app-debug.apk";
        appendLog("--- Downloading APK ---");
        appendLog("URL: " + apkUrl);
        setStatus("Downloading APK...");

        try {
            URL url = new URL(apkUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(30000);
            conn.connect();

            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                appendLog("HTTP error: " + responseCode);
                setStatus("Download failed: HTTP " + responseCode);
                return;
            }

            int fileSize = conn.getContentLength();
            appendLog("File size: " + (fileSize / 1024) + " KB");

            File apkFile = new File(getCacheDir(), "update.apk");
            InputStream in = conn.getInputStream();
            FileOutputStream out = new FileOutputStream(apkFile);

            byte[] buf = new byte[8192];
            int total = 0, len;
            while ((len = in.read(buf)) != -1) {
                out.write(buf, 0, len);
                total += len;
                if (fileSize > 0) setStatus("Downloading: " + (total * 100 / fileSize) + "%");
            }
            out.close();
            in.close();
            conn.disconnect();

            appendLog("Download complete: " + (total / 1024) + " KB");
            setStatus("Download complete. Installing...");
            mainHandler.post(() -> installApk(apkFile));

        } catch (Exception e) {
            appendLog("Download error: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            setStatus("Download FAILED: " + e.getMessage());
        }
    }

    private void installApk(File apkFile) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri apkUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                apkUri = Uri.fromFile(apkFile);
            }
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            appendLog("Install error: " + e.getMessage());
            setStatus("Install FAILED: " + e.getMessage());
        }
    }

    // ---- Printer functions ----

    private volatile boolean initRunning = false;

    private void initPrinter() {
        if (initRunning) {
            appendLog("Init already running, please wait...");
            return;
        }
        initRunning = true;
        try {
            setStatus("Initializing SDK...");
            appendLog("--- Init Start ---");

            printer.setLogListener(msg -> {
                appendLog(msg);
                setStatus("Init: " + msg);
            });

            printer.init(this);

            setStatus("Opening printer...");
            printer.open();
            appendLog("Printer opened OK");
            setStatus("Printer ready");
        } catch (Exception e) {
            Log.e(TAG, "Init failed", e);
            setStatus("INIT FAILED: " + shortMessage(e));
        } finally {
            printer.setLogListener(null);
            initRunning = false;
        }
    }

    private String shortMessage(Exception e) {
        String msg = e.getMessage();
        if (msg == null) return e.getClass().getSimpleName();
        int idx = msg.indexOf("\n");
        return idx > 0 ? msg.substring(0, idx) : msg;
    }

    private void printTextDemo() {
        try {
            setStatus("Printing text...");
            appendLog("--- Text Print ---");

            String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
                    .format(new Date());

            printer.printlnText("================================");
            printer.printlnText("      WizarPOS TEST PRINT       ");
            printer.printlnText("================================");
            printer.printlnText("");
            printer.printlnText("Date: " + timestamp);
            printer.printlnText("");
            printer.printlnText("Normal text line");
            printer.printlnText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
            printer.printlnText("abcdefghijklmnopqrstuvwxyz");
            printer.printlnText("0123456789");
            printer.printlnText("!@#$%^&*()_+-=[]{}|;':\",./<>?");
            printer.printlnText("");
            printer.printlnText("--- Receipt Sample ---");
            printer.printlnText("Item A            $10.00");
            printer.printlnText("Item B             $5.50");
            printer.printlnText("Item C            $23.99");
            printer.printlnText("--------------------------------");
            printer.printlnText("TOTAL             $39.49");
            printer.printlnText("");
            printer.printlnText("");

            appendLog("Text print OK");
            setStatus("Text print completed");
        } catch (Exception e) {
            Log.e(TAG, "Text print failed", e);
            appendLog("Text FAIL: " + e.getMessage());
            setStatus("Text print FAILED");
        }
    }

    private void printImageDemo() {
        try {
            setStatus("Printing image...");
            appendLog("--- Image Print ---");

            printer.printlnText("--- IMAGE TEST ---");
            printer.printlnText("");

            Bitmap testBitmap = createTestBitmap();
            printer.printBitmap(testBitmap);
            testBitmap.recycle();

            printer.printlnText("");
            printer.printlnText("Image test done");
            printer.printlnText("");
            printer.printlnText("");

            appendLog("Image print OK");
            setStatus("Image print completed");
        } catch (Exception e) {
            Log.e(TAG, "Image print failed", e);
            appendLog("Image FAIL: " + e.getMessage());
            setStatus("Image print FAILED");
        }
    }

    private void printAllTests() {
        setStatus("Running all tests...");
        appendLog("=== ALL TESTS ===");
        initPrinter();
        printTextDemo();
        printImageDemo();
        feedAndCut();
        appendLog("=== ALL DONE ===");
        setStatus("All tests completed");
    }

    private void feedAndCut() {
        try {
            setStatus("Feed & cut...");
            printer.printlnText("");
            printer.printlnText("");
            printer.printlnText("");
            printer.cutPaper();
            appendLog("Cut paper OK");
            setStatus("Paper cut done");
        } catch (Exception e) {
            Log.e(TAG, "Cut failed", e);
            appendLog("Cut FAIL: " + e.getMessage());
            setStatus("Cut paper FAILED");
        }
    }

    private void showDiagnostics() {
        appendLog("--- Diagnostics ---");
        appendLog(printer.getDiagnostics());
    }

    private void copyLog() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("PrinterLog", logBuffer.toString());
        clipboard.setPrimaryClip(clip);
        Toast.makeText(this, "Log copied to clipboard", Toast.LENGTH_SHORT).show();
    }

    private void shareLog() {
        if (lastHostIp.isEmpty()) {
            Toast.makeText(this, "No host IP set — use Update to set one first", Toast.LENGTH_SHORT).show();
            return;
        }
        String ip = lastHostIp;
        Toast.makeText(this, "Sending log to " + ip + "...", Toast.LENGTH_SHORT).show();
        runOnThread(() -> {
            try {
                // Flush writer then read from log file, fall back to in-memory buffer
                synchronized (MainActivity.this) {
                    if (logWriter != null) logWriter.flush();
                }
                byte[] data;
                if (logFile != null && logFile.exists() && logFile.length() > 0) {
                    java.io.FileInputStream fis = new java.io.FileInputStream(logFile);
                    data = new byte[(int) logFile.length()];
                    int read = 0;
                    while (read < data.length) {
                        int n = fis.read(data, read, data.length - read);
                        if (n < 0) break;
                        read += n;
                    }
                    fis.close();
                } else {
                    data = logBuffer.toString().getBytes("UTF-8");
                }

                URL url = new URL("http://" + ip + ":" + DEFAULT_SERVER_PORT + "/log");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(3000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "text/plain");
                conn.setRequestProperty("Content-Length", String.valueOf(data.length));
                conn.getOutputStream().write(data);
                conn.getOutputStream().close();
                int code = conn.getResponseCode();
                conn.disconnect();
                if (code == 200) setStatus("Log sent to " + ip);
                else setStatus("Send failed: HTTP " + code);
            } catch (Exception e) {
                setStatus("Send failed: " + e.getMessage());
            }
        });
    }

    private void initLogFile() {
        try {
            File logDir = new File(getFilesDir(), "logs");
            boolean dirOk = logDir.exists() || logDir.mkdirs();
            logFile = new File(logDir, "printer_diag.log");
            logWriter = new PrintWriter(new BufferedWriter(new FileWriter(logFile, false)));
            logWriter.println("=== WizarPOS Diagnostic Log ===");
            logWriter.println("Device:  " + Build.MANUFACTURER + " " + Build.MODEL);
            logWriter.println("Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
            logWriter.println("Path:    " + logFile.getAbsolutePath());
            logWriter.println("Dir OK:  " + dirOk);
            logWriter.println("Started: " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date()));
            logWriter.println("================================");
            logWriter.flush();
            Log.d(TAG, "Log file: " + logFile.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "Failed to init log file: " + e.getMessage(), e);
            logWriter = null;
        }
    }

    private synchronized void writeToLogFile(String message) {
        if (logWriter == null) return;
        logWriter.println(message);
        logWriter.flush();
    }

    private Bitmap createTestBitmap() {
        int width = 384, height = 150;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);

        Paint paint = new Paint();
        paint.setColor(Color.BLACK);
        paint.setAntiAlias(true);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3);
        canvas.drawRect(5, 5, width - 5, height - 5, paint);

        paint.setStyle(Paint.Style.FILL);
        paint.setTextSize(28);
        paint.setTextAlign(Paint.Align.CENTER);
        canvas.drawText("WizarPOS", width / 2f, 55, paint);

        paint.setTextSize(20);
        canvas.drawText("Test Image Print", width / 2f, 85, paint);

        paint.setStrokeWidth(2);
        for (int x = 20; x < width - 20; x += 10) {
            canvas.drawLine(x, 110, x + 5, 130, paint);
        }

        return bitmap;
    }

    private void saveHostIp(String ip) {
        lastHostIp = ip;
        prefs.edit().putString("last_host_ip", ip).apply();
    }

    private void runOnThread(Runnable task) {
        new Thread(task).start();
    }

    private void setStatus(String message) {
        Log.d(TAG, message);
        writeToLogFile("[STATUS] " + message);
        mainHandler.post(() -> tvStatus.setText("Status: " + message));
    }

    private void appendLog(String message) {
        Log.d(TAG, message);
        writeToLogFile(message);
        mainHandler.post(() -> {
            logBuffer.append(message).append("\n");
            tvLog.setText(logBuffer.toString());
            scrollLog.post(() -> scrollLog.fullScroll(ScrollView.FOCUS_DOWN));
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (printer != null) printer.close();
        if (customerDisplay != null) customerDisplay.close();
        if (logWriter != null) { logWriter.flush(); logWriter.close(); logWriter = null; }
    }
}
