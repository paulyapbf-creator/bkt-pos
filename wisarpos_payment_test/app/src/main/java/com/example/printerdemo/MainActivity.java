package com.example.printerdemo;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import com.google.android.material.tabs.TabLayout;

import com.example.printerdemo.printer.ReceiptPrinter;


import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.Collections;
import java.util.List;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "PrinterTest";
    private static final int DEFAULT_SERVER_PORT = 8888;

    // eWallet ID shortcut buttons
    private Button btnEWalletIdS95, btnEWalletIdDuitNow, btnEWalletIdTnG, btnEWalletIdBoost,
                   btnEWalletIdShopeePay, btnEWalletIdGrabPay, btnEWalletIdMAE;

    // eWallet (App2App)
    private TextView etEWalletAmount;
    private long walletCents = 0;
    private EditText etEWalletId;
    private EditText etEWalletOrderId;
    private EditText etEWalletPkgName;
    private EditText etEWalletClassName;
    private EditText etEWalletIndexM;
    private EditText etEWalletIndexT;
    private TextView tvEWalletStatus;
    private TextView tvEWalletPass;
    private TextView tvEWalletFail;
    private android.widget.ListView lvEWalletResponses;
    private ArrayAdapter<String> eWalletResponseAdapter;
    static int eWalletPassCount = 0;
    static int eWalletFailCount = 0;
    static String eWalletLastResult = "";
    static final java.util.ArrayList<String> eWalletResponses = new java.util.ArrayList<>();
    static final java.util.ArrayList<String> eWalletResponseDetails = new java.util.ArrayList<>();

    // Terminal / Sale tab
    private TextView etTerminalAmount;
    private long terminalCents = 0;
    private EditText etTerminalPkgName;
    private EditText etTerminalClassName;
    private EditText etTerminalIndexM;
    private EditText etTerminalIndexT;
    private EditText etTerminalOrderId;
    private TextView tvTerminalStatus;
    private TextView tvTerminalPass;
    private TextView tvTerminalFail;
    private android.widget.ListView lvTerminalResponses;
    private ArrayAdapter<String> terminalResponseAdapter;
    static String terminalLastRequest = "";
    static int lastTypeOfSale = 0;
    static final java.util.ArrayList<String> terminalResponses = new java.util.ArrayList<>();
    static final java.util.ArrayList<String> terminalResponseDetails = new java.util.ArrayList<>();
    static int terminalPassCount = 0;
    static int terminalFailCount = 0;
    private static int sqn = 0;

    // Report tab
    private TextView tvReportDate;
    private TextView tvRptWalletCount, tvRptWalletAmt;
    private TextView tvRptCardCount,   tvRptCardAmt;
    private TextView tvRptTotalCount,  tvRptTotalAmt;
    private TextView tvRptFailCount;
    private android.widget.ListView lvReportList;
    private ArrayAdapter<String> reportAdapter;
    private final java.util.ArrayList<String> reportRows = new java.util.ArrayList<>();
    private final java.util.ArrayList<String> reportDetails = new java.util.ArrayList<>();
    private java.util.Calendar reportDate = java.util.Calendar.getInstance();
    private String reportFilter = "both"; // "both" | "approved" | "failed"
    // Cached last-loaded report data for printing
    private volatile List<TransactionRecord> reportRecords = new java.util.ArrayList<>();
    private volatile int    rptWalletCount, rptCardCount, rptFailCount;
    private volatile double rptWalletAmt,   rptCardAmt;

    // Persistent DB
    private TransactionDatabase txnDb;

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
        txnDb = new TransactionDatabase(this);

        // --- Maintain tab views (settings live here) ---
        etEWalletPkgName   = findViewById(R.id.etEWalletPkgName);
        etEWalletClassName = findViewById(R.id.etEWalletClassName);
        etEWalletIndexM    = findViewById(R.id.etEWalletIndexM);
        etEWalletIndexT    = findViewById(R.id.etEWalletIndexT);
        etEWalletId        = findViewById(R.id.etEWalletId);
        etEWalletOrderId   = findViewById(R.id.etEWalletOrderId);
        etTerminalPkgName   = findViewById(R.id.etTerminalPkgName);
        etTerminalClassName = findViewById(R.id.etTerminalClassName);
        etTerminalIndexM    = findViewById(R.id.etTerminalIndexM);
        etTerminalIndexT    = findViewById(R.id.etTerminalIndexT);
        btnEWalletIdS95      = findViewById(R.id.btnEWalletIdS95);
        btnEWalletIdDuitNow  = findViewById(R.id.btnEWalletIdDuitNow);
        btnEWalletIdTnG      = findViewById(R.id.btnEWalletIdTnG);
        btnEWalletIdBoost    = findViewById(R.id.btnEWalletIdBoost);
        btnEWalletIdShopeePay= findViewById(R.id.btnEWalletIdShopeePay);
        btnEWalletIdGrabPay  = findViewById(R.id.btnEWalletIdGrabPay);
        btnEWalletIdMAE      = findViewById(R.id.btnEWalletIdMAE);
        btnEWalletIdS95.setOnClickListener(v ->      { etEWalletId.setText("S97");      selectEWalletIdBtn(btnEWalletIdS95); });
        btnEWalletIdDuitNow.setOnClickListener(v ->  { etEWalletId.setText("DuitNow");  selectEWalletIdBtn(btnEWalletIdDuitNow); });
        btnEWalletIdTnG.setOnClickListener(v ->      { etEWalletId.setText("TnG");      selectEWalletIdBtn(btnEWalletIdTnG); });
        btnEWalletIdBoost.setOnClickListener(v ->    { etEWalletId.setText("Boost");    selectEWalletIdBtn(btnEWalletIdBoost); });
        btnEWalletIdShopeePay.setOnClickListener(v ->{ etEWalletId.setText("ShopeePay");selectEWalletIdBtn(btnEWalletIdShopeePay); });
        btnEWalletIdGrabPay.setOnClickListener(v ->  { etEWalletId.setText("S94");      selectEWalletIdBtn(btnEWalletIdGrabPay); });
        btnEWalletIdMAE.setOnClickListener(v ->      { etEWalletId.setText("S95");      selectEWalletIdBtn(btnEWalletIdMAE); });
        findViewById(R.id.btnEWalletIdClear).setOnClickListener(v -> { etEWalletId.setText(""); selectEWalletIdBtn(null); });
        Button btnCopy   = findViewById(R.id.btnCopy);
        Button btnShare  = findViewById(R.id.btnShare);
        Button btnUpdate = findViewById(R.id.btnUpdate);
        btnCopy.setOnClickListener(v -> copyLog());
        btnShare.setOnClickListener(v -> shareLog());
        btnUpdate.setOnClickListener(v -> showUpdateDialog());

        TextView tvAppVersion = findViewById(R.id.tvAppVersion);
        try {
            android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            tvAppVersion.setText(pi.versionName + "  (build " + pi.versionCode + "  |  " + BuildConfig.BUILD_DATE + ")");
        } catch (PackageManager.NameNotFoundException ignored) {}

        // --- eWallet tab views ---
        etEWalletAmount     = findViewById(R.id.etEWalletAmount);
        tvEWalletStatus     = findViewById(R.id.tvEWalletStatus);
        tvEWalletPass       = findViewById(R.id.tvEWalletPass);
        tvEWalletFail       = findViewById(R.id.tvEWalletFail);
        lvEWalletResponses  = findViewById(R.id.lvEWalletResponses);
        tvEWalletPass.setText(String.valueOf(eWalletPassCount));
        tvEWalletFail.setText(String.valueOf(eWalletFailCount));
        eWalletResponseAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_list_item_1, eWalletResponses);
        lvEWalletResponses.setAdapter(eWalletResponseAdapter);
        lvEWalletResponses.setEmptyView(findViewById(R.id.tvEWalletEmpty));
        lvEWalletResponses.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < eWalletResponseDetails.size()) {
                showTerminalDetail(eWalletResponseDetails.get(position));
            }
        });
        eWalletResponseAdapter.notifyDataSetChanged();
        findViewById(R.id.btnEWalletQR).setOnClickListener(v -> launchEWallet(true));
        setupWalletNumpad();

        // --- Terminal / Sale tab views ---
        etTerminalAmount  = findViewById(R.id.etTerminalAmount);
        etTerminalOrderId = findViewById(R.id.etTerminalOrderId);
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
        setupTerminalNumpad();
        findViewById(R.id.btnTerminalSale).setOnClickListener(v -> launchSale());

        // --- Report tab views ---
        tvReportDate    = findViewById(R.id.tvReportDate);
        tvRptWalletCount= findViewById(R.id.tvRptWalletCount);
        tvRptWalletAmt  = findViewById(R.id.tvRptWalletAmt);
        tvRptCardCount  = findViewById(R.id.tvRptCardCount);
        tvRptCardAmt    = findViewById(R.id.tvRptCardAmt);
        tvRptTotalCount = findViewById(R.id.tvRptTotalCount);
        tvRptTotalAmt   = findViewById(R.id.tvRptTotalAmt);
        tvRptFailCount  = findViewById(R.id.tvRptFailCount);
        lvReportList    = findViewById(R.id.lvReportList);
        reportAdapter   = new ArrayAdapter<String>(this, 0, reportRows) {
            @Override
            public View getView(int position, View convertView, android.view.ViewGroup parent) {
                android.widget.TextView tv = (convertView instanceof android.widget.TextView)
                        ? (android.widget.TextView) convertView
                        : new android.widget.TextView(getContext());
                tv.setText(getItem(position));
                int p = (int) (10 * getResources().getDisplayMetrics().density);
                tv.setPadding(p, p, p, p);
                tv.setTextSize(12.5f);
                tv.setLineSpacing(3, 1f);
                return tv;
            }
        };
        lvReportList.setAdapter(reportAdapter);
        lvReportList.setEmptyView(findViewById(R.id.tvReportEmpty));
        lvReportList.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < reportDetails.size())
                showTerminalDetail(reportDetails.get(position));
        });
        ((android.widget.RadioGroup) findViewById(R.id.rgReportFilter))
                .setOnCheckedChangeListener((group, checkedId) -> {
                    if (checkedId == R.id.rbFilterApproved)  reportFilter = "approved";
                    else if (checkedId == R.id.rbFilterFailed) reportFilter = "failed";
                    else                                       reportFilter = "both";
                    applyReportFilter();
                });

        tvReportDate.setOnClickListener(v -> showReportDatePicker());
        findViewById(R.id.btnReportPrevDay).setOnClickListener(v -> {
            reportDate.add(java.util.Calendar.DAY_OF_MONTH, -1);
            runOnThread(this::loadReport);
        });
        findViewById(R.id.btnReportNextDay).setOnClickListener(v -> {
            reportDate.add(java.util.Calendar.DAY_OF_MONTH, 1);
            runOnThread(this::loadReport);
        });
        findViewById(R.id.btnPrintReport).setOnClickListener(v -> printReportAsync());

        // --- Tab panels ---
        android.widget.ScrollView tabMaintain = findViewById(R.id.tabMaintain);
        LinearLayout tabWallet                = findViewById(R.id.tabWallet);
        LinearLayout tabTerminal              = findViewById(R.id.tabTerminal);
        LinearLayout tabReport                = findViewById(R.id.tabReport);

        prefs = getSharedPreferences("printer_test", MODE_PRIVATE);
        lastHostIp = prefs.getString("last_host_ip", "");
        initLogFile();

        // --- Tab switching ---
        TabLayout tabLayout = findViewById(R.id.tabLayout);
        tabLayout.addTab(tabLayout.newTab().setText("Maintain"));
        tabLayout.addTab(tabLayout.newTab().setText("Wallet"));
        tabLayout.addTab(tabLayout.newTab().setText("Credit Card"));
        tabLayout.addTab(tabLayout.newTab().setText("Report"));
        tabLayout.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                tabMaintain.setVisibility(View.GONE);
                tabWallet.setVisibility(View.GONE);
                tabTerminal.setVisibility(View.GONE);
                tabReport.setVisibility(View.GONE);
                switch (tab.getPosition()) {
                    case 0: tabMaintain.setVisibility(View.VISIBLE); break;
                    case 1:
                        tabWallet.setVisibility(View.VISIBLE);
                        tvEWalletPass.setText(String.valueOf(eWalletPassCount));
                        tvEWalletFail.setText(String.valueOf(eWalletFailCount));
                        if (!eWalletLastResult.isEmpty()) {
                            tvEWalletStatus.setText(eWalletLastResult);
                        }
                        eWalletResponseAdapter.notifyDataSetChanged();
                        break;
                    case 2:
                        tabTerminal.setVisibility(View.VISIBLE);
                        tvTerminalPass.setText(String.valueOf(terminalPassCount));
                        tvTerminalFail.setText(String.valueOf(terminalFailCount));
                        terminalResponseAdapter.notifyDataSetChanged();
                        break;
                    case 3:
                        tabReport.setVisibility(View.VISIBLE);
                        runOnThread(MainActivity.this::loadReport);
                        break;
                }
            }
            @Override public void onTabUnselected(TabLayout.Tab tab) {}
            @Override public void onTabReselected(TabLayout.Tab tab) {}
        });
    }

    private void selectEWalletIdBtn(Button selected) {
        Button[] all = {btnEWalletIdS95, btnEWalletIdDuitNow, btnEWalletIdTnG,
                        btnEWalletIdBoost, btnEWalletIdShopeePay, btnEWalletIdGrabPay, btnEWalletIdMAE};
        for (Button b : all) {
            if (b == selected) {
                b.setBackgroundColor(0xFFE0E0E0);  // light grey
                b.setTextColor(0xFF1976D2);         // blue text
            } else {
                b.setBackgroundColor(0xFFE0E0E0);  // light grey
                b.setTextColor(0xFF212121);         // dark text
            }
        }
    }

    // ---- eWallet numpad (cent-first) ----

    private void setupWalletNumpad() {
        int[] digitIds = {R.id.btnNum0, R.id.btnNum1, R.id.btnNum2, R.id.btnNum3,
                          R.id.btnNum4, R.id.btnNum5, R.id.btnNum6, R.id.btnNum7,
                          R.id.btnNum8, R.id.btnNum9};
        for (int i = 0; i < digitIds.length; i++) {
            final int digit = i;
            findViewById(digitIds[i]).setOnClickListener(v -> {
                walletCents = walletCents * 10 + digit;
                if (walletCents > 9999999) walletCents = 9999999; // cap at 99999.99
                etEWalletAmount.setText(centsToDisplay(walletCents));
            });
        }
        // "00" button
        findViewById(R.id.btnNumDot).setOnClickListener(v -> {
            walletCents = walletCents * 100;
            if (walletCents > 9999999) walletCents = 9999999;
            etEWalletAmount.setText(centsToDisplay(walletCents));
        });
        findViewById(R.id.btnNumBack).setOnClickListener(v -> {
            walletCents = walletCents / 10;
            etEWalletAmount.setText(centsToDisplay(walletCents));
        });
    }

    // ---- Terminal numpad (cent-first) ----

    private void setupTerminalNumpad() {
        int[] digitIds = {R.id.btnTNum0, R.id.btnTNum1, R.id.btnTNum2, R.id.btnTNum3,
                          R.id.btnTNum4, R.id.btnTNum5, R.id.btnTNum6, R.id.btnTNum7,
                          R.id.btnTNum8, R.id.btnTNum9};
        for (int i = 0; i < digitIds.length; i++) {
            final int digit = i;
            findViewById(digitIds[i]).setOnClickListener(v -> {
                terminalCents = terminalCents * 10 + digit;
                if (terminalCents > 9999999) terminalCents = 9999999;
                etTerminalAmount.setText(centsToDisplay(terminalCents));
            });
        }
        // "00" button
        findViewById(R.id.btnTNumDot).setOnClickListener(v -> {
            terminalCents = terminalCents * 100;
            if (terminalCents > 9999999) terminalCents = 9999999;
            etTerminalAmount.setText(centsToDisplay(terminalCents));
        });
        findViewById(R.id.btnTNumBack).setOnClickListener(v -> {
            terminalCents = terminalCents / 10;
            etTerminalAmount.setText(centsToDisplay(terminalCents));
        });
    }

    private String centsToDisplay(long cents) {
        return String.format(Locale.US, "%,.2f", cents / 100.0);
    }

    // ---- eWallet (App2App) ----

    private void launchEWallet(boolean useQR) {
        String pkgName   = etEWalletPkgName.getText().toString().trim();
        String clsName   = etEWalletClassName.getText().toString().trim();
        String amount    = String.format(Locale.US, "%.2f", walletCents / 100.0);
        String eWalletId = etEWalletId.getText().toString().trim();
        String orderId   = etEWalletOrderId.getText().toString().trim();
        int    indexM    = parseIndex(etEWalletIndexM, 1);
        int    indexT    = parseIndex(etEWalletIndexT, 1);

        if (walletCents <= 0) {
            Toast.makeText(this, "Enter amount", Toast.LENGTH_SHORT).show();
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
                intent.putExtra("eWalletId", eWalletId);
            }
            if (!orderId.isEmpty()) {
                intent.putExtra("orderId", orderId);
            }
            intent.putExtra("ClassName",   "com.example.printerdemo.PaymentResultActivity");
            intent.putExtra("PackageName", "com.example.printerdemo");

            terminalLastRequest = buildSaleRequestDetails(intent);
            lastTypeOfSale = 66;
            String mode = useQR ? "E-Wallet QR" : "E-Wallet";
            appendLog("[EWALLET] " + mode + " launched pkg=" + pkgName + " amt=" + amount);
            tvEWalletStatus.setText("Launched: " + mode + "  amt=" + amount + "\n→ " + pkgName);
            tvEWalletStatus.setBackgroundColor(0xFFE3F2FD);
            eWalletLastResult = "";
            walletCents = 0;
            etEWalletAmount.setText(centsToDisplay(0));

            playPaymentBeep();
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
        appendLog("[EWALLET] Simulated eWallet amt=" + amount + " approved=" + approved);
        startActivity(result);
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
        String amount  = String.format(Locale.US, "%.2f", terminalCents / 100.0);
        String orderId = etTerminalOrderId.getText().toString().trim();

        if (terminalCents <= 0) {
            tvTerminalStatus.setText("Enter amount");
            tvTerminalStatus.setBackgroundColor(0xFFFFCDD2);
            Toast.makeText(this, "Enter amount", Toast.LENGTH_SHORT).show();
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
            lastTypeOfSale = 1;
            appendLog("[TERMINAL] SALE launched pkg=" + pkgName + " amt=" + amount);
            tvTerminalStatus.setText("Launched: SALE  amt=" + amount);
            tvTerminalStatus.setBackgroundColor(0xFFE3F2FD);
            terminalCents = 0;
            etTerminalAmount.setText(centsToDisplay(0));

            playPaymentBeep();
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

    private void playPaymentBeep() {
        try {
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, ToneGenerator.MAX_VOLUME);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
            mainHandler.postDelayed(() -> {
                tg.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
                mainHandler.postDelayed(tg::release, 200);
            }, 180);
        } catch (Exception ignored) {}
    }

    private String getSQN() {
        if (sqn > 99) sqn = 0;
        String s = Integer.toString(sqn++);
        return s.length() == 1 ? "0" + s : s;
    }

    // ---- Maintain / Log ----

    private void copyLog() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("Log", logBuffer.toString());
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
                mainHandler.post(() -> Toast.makeText(this,
                        code == 200 ? "Log sent to " + ip : "Send failed: HTTP " + code,
                        Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                mainHandler.post(() -> Toast.makeText(this,
                        "Send failed: " + e.getMessage(), Toast.LENGTH_SHORT).show());
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
                    downloadAndInstall(testIp);
                    return;
                }
            } catch (Exception ignored) {}
        }

        appendLog("No PC server found on subnet");
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

        try {
            URL url = new URL(apkUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(30000);
            conn.connect();

            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                appendLog("HTTP error: " + responseCode);
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
            }
            out.close();
            in.close();
            conn.disconnect();

            appendLog("Download complete: " + (total / 1024) + " KB");
            mainHandler.post(() -> installApk(apkFile));

        } catch (Exception e) {
            appendLog("Download error: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private void installApk(File apkFile) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            android.net.Uri apkUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                apkUri = android.net.Uri.fromFile(apkFile);
            }
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            appendLog("Install error: " + e.getMessage());
        }
    }

    private void saveHostIp(String ip) {
        lastHostIp = ip;
        prefs.edit().putString("last_host_ip", ip).apply();
    }

    private void runOnThread(Runnable task) {
        new Thread(task).start();
    }

    private void appendLog(String message) {
        Log.d(TAG, message);
        writeToLogFile(message);
        mainHandler.post(() -> logBuffer.append(message).append("\n"));
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

    @Override
    protected void onResume() {
        super.onResume();
        runOnThread(this::reloadFromDb);
    }

    private void reloadFromDb() {
        List<TransactionRecord> wallets = txnDb.getByType("eWallet");
        List<TransactionRecord> cards   = txnDb.getByType("Card");

        // Recompute counts from DB
        int wPass = 0, wFail = 0, cPass = 0, cFail = 0;
        for (TransactionRecord r : wallets) {
            if ("Approved".equals(r.status)) wPass++; else wFail++;
        }
        for (TransactionRecord r : cards) {
            if ("Approved".equals(r.status)) cPass++; else cFail++;
        }
        final int wp = wPass, wf = wFail, cp = cPass, cf = cFail;

        mainHandler.post(() -> {
            // Wallet tab
            eWalletResponses.clear();
            eWalletResponseDetails.clear();
            for (TransactionRecord r : wallets) {
                eWalletResponses.add(r.listLabel());
                eWalletResponseDetails.add(r.rawDetails);
            }
            eWalletPassCount = wp;
            eWalletFailCount = wf;
            tvEWalletPass.setText(String.valueOf(wp));
            tvEWalletFail.setText(String.valueOf(wf));
            eWalletResponseAdapter.notifyDataSetChanged();

            // Terminal tab
            terminalResponses.clear();
            terminalResponseDetails.clear();
            for (TransactionRecord r : cards) {
                terminalResponses.add(r.listLabel());
                terminalResponseDetails.add(r.rawDetails);
            }
            terminalPassCount = cp;
            terminalFailCount = cf;
            tvTerminalPass.setText(String.valueOf(cp));
            tvTerminalFail.setText(String.valueOf(cf));
            terminalResponseAdapter.notifyDataSetChanged();
        });
    }

    // ---- Report tab ----

    private void printReportAsync() {
        if (reportRecords.isEmpty()) {
            Toast.makeText(this, "No transactions to print", Toast.LENGTH_SHORT).show();
            return;
        }
        String dateStr = tvReportDate.getText().toString();

        // Apply same filter as the list
        List<TransactionRecord> snapshot = new java.util.ArrayList<>();
        for (TransactionRecord r : reportRecords) {
            boolean include = "both".equals(reportFilter)
                    || ("approved".equals(reportFilter) && "Approved".equals(r.status))
                    || ("failed".equals(reportFilter)   && !"Approved".equals(r.status));
            if (include) snapshot.add(r);
        }

        if (snapshot.isEmpty()) {
            Toast.makeText(this, "No transactions to print", Toast.LENGTH_SHORT).show();
            return;
        }

        // Recompute totals from filtered snapshot
        int wc = 0, cc = 0, fc = 0;
        double wa = 0, ca = 0;
        for (TransactionRecord r : snapshot) {
            if ("Approved".equals(r.status)) {
                double amt = 0;
                try { amt = Double.parseDouble(r.amount); } catch (Exception ignored) {}
                if ("eWallet".equals(r.txnType)) { wc++; wa += amt; }
                else                              { cc++; ca += amt; }
            } else {
                fc++;
            }
        }

        final int fwc = wc, fcc = cc, ffc = fc;
        final double fwa = wa, fca = ca;
        Toast.makeText(this, "Printing report...", Toast.LENGTH_SHORT).show();
        runOnThread(() -> {
            try {
                new ReceiptPrinter(this).printReport(dateStr, snapshot, fwc, fwa, fcc, fca, ffc);
                mainHandler.post(() -> Toast.makeText(this, "Report printed", Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                mainHandler.post(() -> Toast.makeText(this,
                        "Print failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void showReportDatePicker() {
        int y = reportDate.get(java.util.Calendar.YEAR);
        int m = reportDate.get(java.util.Calendar.MONTH);
        int d = reportDate.get(java.util.Calendar.DAY_OF_MONTH);
        new android.app.DatePickerDialog(this, (picker, year, month, day) -> {
            reportDate.set(year, month, day);
            runOnThread(this::loadReport);
        }, y, m, d).show();
    }

    private void loadReport() {
        String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(reportDate.getTime());

        java.util.Calendar start = (java.util.Calendar) reportDate.clone();
        start.set(java.util.Calendar.HOUR_OF_DAY, 0);
        start.set(java.util.Calendar.MINUTE, 0);
        start.set(java.util.Calendar.SECOND, 0);
        start.set(java.util.Calendar.MILLISECOND, 0);
        long startMs = start.getTimeInMillis();
        long endMs   = startMs + 24L * 60 * 60 * 1000;

        List<TransactionRecord> records = txnDb.getByDate(dateStr, startMs, endMs);

        int walletCount = 0, cardCount = 0, failCount = 0;
        double walletAmt = 0, cardAmt = 0;
        java.util.ArrayList<String> rows    = new java.util.ArrayList<>();
        java.util.ArrayList<String> details = new java.util.ArrayList<>();

        for (TransactionRecord r : records) {
            rows.add(r.reportLabel());
            details.add(r.rawDetails);
            if ("Approved".equals(r.status)) {
                double amt = 0;
                try { amt = Double.parseDouble(r.amount); } catch (Exception ignored) {}
                if ("eWallet".equals(r.txnType)) { walletCount++; walletAmt += amt; }
                else                              { cardCount++;   cardAmt   += amt; }
            } else {
                failCount++;
            }
        }

        final int wc = walletCount, cc = cardCount, fc = failCount;
        final double wa = walletAmt, ca = cardAmt;

        // Cache for printing and filter re-use
        reportRecords   = new java.util.ArrayList<>(records);
        rptWalletCount  = wc;  rptWalletAmt = wa;
        rptCardCount    = cc;  rptCardAmt   = ca;
        rptFailCount    = fc;

        mainHandler.post(() -> {
            tvReportDate.setText(dateStr);
            tvRptWalletCount.setText(String.valueOf(wc));
            tvRptWalletAmt.setText(String.format(Locale.US, "MYR %.2f", wa));
            tvRptCardCount.setText(String.valueOf(cc));
            tvRptCardAmt.setText(String.format(Locale.US, "MYR %.2f", ca));
            tvRptTotalCount.setText(String.valueOf(wc + cc));
            tvRptTotalAmt.setText(String.format(Locale.US, "MYR %.2f", wa + ca));
            tvRptFailCount.setText(String.valueOf(fc));
            applyReportFilter();
        });
    }

    private void applyReportFilter() {
        reportRows.clear();
        reportDetails.clear();
        for (TransactionRecord r : reportRecords) {
            boolean show = "both".equals(reportFilter)
                    || ("approved".equals(reportFilter) && "Approved".equals(r.status))
                    || ("failed".equals(reportFilter)   && !"Approved".equals(r.status));
            if (show) {
                reportRows.add(r.reportLabel());
                reportDetails.add(r.rawDetails);
            }
        }
        reportAdapter.notifyDataSetChanged();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (logWriter != null) { logWriter.flush(); logWriter.close(); logWriter = null; }
        if (txnDb != null) txnDb.close();
    }
}
