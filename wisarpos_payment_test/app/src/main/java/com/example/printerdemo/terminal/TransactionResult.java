package com.example.printerdemo.terminal;

import android.content.Intent;

import java.util.ArrayList;

/**
 * Parses all Value_x extras returned by the K9 terminal.
 * Field mapping extracted from app2app Main_Second.getKeyDescription().
 */
public class TransactionResult {

    public final String status;        // Value_1  "00" = approved
    public final String message;       // Value_2  result text
    public final String amount;        // Value_3  amount
    public final String cardNumber;    // Value_4
    public final String cardBrand;     // Value_5
    public final String expiryDate;    // Value_6
    public final String approvalCode;  // Value_7
    public final String rrn;           // Value_8
    public final String batchNo;       // Value_9
    public final String traceNo;       // Value_10
    public final String txnDate;       // Value_11
    public final String txnTime;       // Value_12
    public final String mid;           // Value_13
    public final String tid;           // Value_14
    public final String invoice;       // Value_15
    public final String ac;            // Value_17  Application Cryptogram
    public final String tvr;           // Value_18  Terminal Verification Results
    public final String responseCode;  // Value_19
    public final ArrayList<String> settlementList; // settlement JSON list
    public final boolean approved;

    public TransactionResult(Intent data) {
        status       = safe(data, "Value_1");
        message      = safe(data, "Value_2");
        amount       = safe(data, "Value_3");
        cardNumber   = safe(data, "Value_4");
        cardBrand    = safe(data, "Value_5");
        expiryDate   = safe(data, "Value_6");
        approvalCode = safe(data, "Value_7");
        rrn          = safe(data, "Value_8");
        batchNo      = safe(data, "Value_9");
        traceNo      = safe(data, "Value_10");
        txnDate      = safe(data, "Value_11");
        txnTime      = safe(data, "Value_12");
        mid          = safe(data, "Value_13");
        tid          = safe(data, "Value_14");
        invoice      = safe(data, "Value_15");
        ac           = safe(data, "Value_17");
        tvr          = safe(data, "Value_18");
        responseCode = safe(data, "Value_19");
        settlementList = data != null ? data.getStringArrayListExtra("settlementList") : null;
        approved     = "00".equals(status);
    }

    private static String safe(Intent data, String key) {
        if (data == null) return "";
        String v = data.getStringExtra(key);
        return v != null ? v.trim() : "";
    }

    @Override
    public String toString() {
        return "Status=" + status + " Msg=" + message
                + " Amt=" + amount + " Card=" + cardNumber
                + " Brand=" + cardBrand + " Approval=" + approvalCode
                + " RRN=" + rrn + " Batch=" + batchNo
                + " MID=" + mid + " TID=" + tid + " Inv=" + invoice;
    }
}
