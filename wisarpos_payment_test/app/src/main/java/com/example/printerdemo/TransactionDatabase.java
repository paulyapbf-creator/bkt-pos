package com.example.printerdemo;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

public class TransactionDatabase extends SQLiteOpenHelper {

    private static final String DB_NAME    = "transactions.db";
    private static final int    DB_VERSION = 1;
    private static final String TABLE      = "transactions";

    public TransactionDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + "("
                + "id            INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "txn_type      TEXT,"
                + "txn_date      TEXT,"
                + "txn_time      TEXT,"
                + "amount        TEXT,"
                + "status        TEXT,"
                + "result_code   TEXT,"
                + "result_text   TEXT,"
                + "tid           TEXT,"
                + "mid           TEXT,"
                + "batch_no      TEXT,"
                + "trace_no      TEXT,"
                + "invoice       TEXT,"
                + "card_number   TEXT,"
                + "card_brand    TEXT,"
                + "approval_code TEXT,"
                + "response_code TEXT,"
                + "rrn           TEXT,"
                + "ewallet_id    TEXT,"
                + "order_id      TEXT,"
                + "raw_details   TEXT,"
                + "created_at    INTEGER"
                + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE);
        onCreate(db);
    }

    public long insert(TransactionRecord r) {
        ContentValues v = new ContentValues();
        v.put("txn_type",      r.txnType);
        v.put("txn_date",      r.txnDate);
        v.put("txn_time",      r.txnTime);
        v.put("amount",        r.amount);
        v.put("status",        r.status);
        v.put("result_code",   r.resultCode);
        v.put("result_text",   r.resultText);
        v.put("tid",           r.tid);
        v.put("mid",           r.mid);
        v.put("batch_no",      r.batchNo);
        v.put("trace_no",      r.traceNo);
        v.put("invoice",       r.invoice);
        v.put("card_number",   r.cardNumber);
        v.put("card_brand",    r.cardBrand);
        v.put("approval_code", r.approvalCode);
        v.put("response_code", r.responseCode);
        v.put("rrn",           r.rrn);
        v.put("ewallet_id",    r.eWalletId);
        v.put("order_id",      r.orderId);
        v.put("raw_details",   r.rawDetails);
        v.put("created_at",    r.createdAt);
        return getWritableDatabase().insert(TABLE, null, v);
    }

    public List<TransactionRecord> getAll() {
        return query(null, null);
    }

    public List<TransactionRecord> getByType(String type) {
        return query("txn_type=?", new String[]{type});
    }

    public int countByTypeAndStatus(String type, String status) {
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT COUNT(*) FROM " + TABLE + " WHERE txn_type=? AND status=?",
                new String[]{type, status});
        int count = 0;
        if (c.moveToFirst()) count = c.getInt(0);
        c.close();
        return count;
    }

    /** Records created within [startMs, endMs) based on created_at timestamp. */
    public List<TransactionRecord> getByDate(String dateStr, long startMs, long endMs) {
        return query("created_at>=? AND created_at<?",
                new String[]{String.valueOf(startMs), String.valueOf(endMs)});
    }

    public void deleteAll() {
        getWritableDatabase().delete(TABLE, null, null);
    }

    public void deleteById(long id) {
        getWritableDatabase().delete(TABLE, "id=?", new String[]{String.valueOf(id)});
    }

    private List<TransactionRecord> query(String sel, String[] args) {
        List<TransactionRecord> list = new ArrayList<>();
        Cursor c = getReadableDatabase().query(
                TABLE, null, sel, args, null, null, "created_at DESC");
        while (c.moveToNext()) list.add(fromCursor(c));
        c.close();
        return list;
    }

    private TransactionRecord fromCursor(Cursor c) {
        TransactionRecord r = new TransactionRecord();
        r.id           = c.getLong(c.getColumnIndexOrThrow("id"));
        r.txnType      = s(c, "txn_type");
        r.txnDate      = s(c, "txn_date");
        r.txnTime      = s(c, "txn_time");
        r.amount       = s(c, "amount");
        r.status       = s(c, "status");
        r.resultCode   = s(c, "result_code");
        r.resultText   = s(c, "result_text");
        r.tid          = s(c, "tid");
        r.mid          = s(c, "mid");
        r.batchNo      = s(c, "batch_no");
        r.traceNo      = s(c, "trace_no");
        r.invoice      = s(c, "invoice");
        r.cardNumber   = s(c, "card_number");
        r.cardBrand    = s(c, "card_brand");
        r.approvalCode = s(c, "approval_code");
        r.responseCode = s(c, "response_code");
        r.rrn          = s(c, "rrn");
        r.eWalletId    = s(c, "ewallet_id");
        r.orderId      = s(c, "order_id");
        r.rawDetails   = s(c, "raw_details");
        r.createdAt    = c.getLong(c.getColumnIndexOrThrow("created_at"));
        return r;
    }

    private String s(Cursor c, String col) {
        String v = c.getString(c.getColumnIndexOrThrow(col));
        return v != null ? v : "";
    }
}
