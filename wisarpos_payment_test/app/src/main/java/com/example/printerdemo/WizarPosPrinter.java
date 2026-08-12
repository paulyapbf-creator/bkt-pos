package com.example.printerdemo;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import android.util.Log;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class WizarPosPrinter {

    private static final String TAG = "WizarPosPrinter";
    private static final String SDK_PACKAGE = "com.cloudpos.sdk.server";

    public interface LogListener {
        void onLog(String message);
    }

    private Object serviceProxy = null;
    private static ClassLoader sdkClassLoader = null;
    private Object printerDevice = null;
    private StringBuilder fullLog = new StringBuilder();
    private Context appContext = null;
    private ServiceConnection activeConn = null;
    private volatile LogListener logListener = null;

    public String getInitLog() { return fullLog.toString(); }

    public void setLogListener(LogListener listener) {
        this.logListener = listener;
    }

    private void log(String msg) {
        fullLog.append(msg).append("\n");
        Log.d(TAG, msg);
        LogListener l = logListener;
        if (l != null) l.onLog(msg);
    }

    public void init(Context context) throws Exception {
        appContext = context.getApplicationContext();
        fullLog = new StringBuilder();

        // Load SDK classloader
        try {
            Context sdkCtx = context.createPackageContext(SDK_PACKAGE,
                    Context.CONTEXT_INCLUDE_CODE | Context.CONTEXT_IGNORE_SECURITY);
            sdkClassLoader = sdkCtx.getClassLoader();
            log("SDK package loaded OK");
        } catch (Exception e) {
            log("SDK package error: " + e.getMessage());
            throw new Exception("Cannot load SDK package: " + e.getMessage());
        }

        // Find services
        PackageInfo pi;
        try {
            pi = context.getPackageManager().getPackageInfo(SDK_PACKAGE, PackageManager.GET_SERVICES);
        } catch (PackageManager.NameNotFoundException e) {
            log("SDK package not installed");
            throw new Exception("com.cloudpos.sdk.server not found");
        }

        if (pi.services == null || pi.services.length == 0) {
            log("No services found");
            throw new Exception("No services in SDK package");
        }

        log("Found " + pi.services.length + " services");

        // List all services
        for (ServiceInfo si : pi.services) {
            log("  svc: " + si.name);
        }

        // Try MainService first, then all other services
        // Sort so MainService comes first
        java.util.List<ServiceInfo> sortedServices = new java.util.ArrayList<>();
        java.util.List<ServiceInfo> others = new java.util.ArrayList<>();
        for (ServiceInfo si : pi.services) {
            if (si.name.contains("MainService")) {
                sortedServices.add(si);
            } else {
                others.add(si);
            }
        }
        sortedServices.addAll(others);

        for (ServiceInfo si : sortedServices) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(SDK_PACKAGE, si.name));

                final CountDownLatch latch = new CountDownLatch(1);
                final IBinder[] binderHolder = new IBinder[1];

                ServiceConnection conn = new ServiceConnection() {
                    @Override
                    public void onServiceConnected(ComponentName name, IBinder binder) {
                        binderHolder[0] = binder;
                        latch.countDown();
                    }
                    @Override
                    public void onServiceDisconnected(ComponentName name) {}
                };

                boolean bindOk = context.bindService(intent, conn, Context.BIND_AUTO_CREATE);
                log("bind(" + si.name + ")=" + bindOk);

                if (!bindOk) continue;

                if (!latch.await(4, TimeUnit.SECONDS)) {
                    log("timeout");
                    try { context.unbindService(conn); } catch (Exception ignored) {}
                    continue;
                }

                IBinder binder = binderHolder[0];
                String desc = binder.getInterfaceDescriptor();
                log("desc=" + desc);

                if (desc == null || desc.isEmpty() || sdkClassLoader == null) {
                    try { context.unbindService(conn); } catch (Exception ignored) {}
                    continue;
                }

                Class<?> stubClass = sdkClassLoader.loadClass(desc + "$Stub");
                Method asInterface = stubClass.getMethod("asInterface", IBinder.class);
                serviceProxy = asInterface.invoke(null, binder);
                activeConn = conn;

                // Check if this proxy has getDevice
                boolean hasGetDevice = false;
                for (Method pm : serviceProxy.getClass().getMethods()) {
                    if (pm.getName().equals("getDevice")) {
                        hasGetDevice = true;
                        break;
                    }
                }
                log("Service proxy OK (hasGetDevice=" + hasGetDevice + ")");
                if (hasGetDevice) break;
                // If no getDevice, try next service
                log("No getDevice on this proxy, trying next service...");
                try { context.unbindService(conn); } catch (Exception ignored) {}
                serviceProxy = null;
                activeConn = null;
            } catch (SecurityException e) {
                log("sec: " + e.getMessage());
            } catch (Exception e) {
                log("err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }

        if (serviceProxy == null) {
            log("No SDK service with getDevice — will try system service in open()");
        }
    }

    public void open() throws Exception {
        // 1. Try "Printer" system service directly (discovered via ServiceManager)
        log("--- Trying Printer system service ---");
        if (tryPrinterSystemService()) return;

        // 2. Try via SDK service proxy getDevice
        if (serviceProxy != null) {
            log("--- Service proxy methods ---");
            for (Method m : serviceProxy.getClass().getMethods()) {
                String n = m.getName();
                if (!n.equals("hashCode") && !n.equals("equals") && !n.equals("toString")
                        && !n.equals("getClass") && !n.equals("notify") && !n.equals("notifyAll")
                        && !n.equals("wait") && !n.equals("asBinder") && !n.equals("getInterfaceDescriptor")) {
                    log("  " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                }
            }
            log("--- Trying getDevice ---");
            tryServiceGetDevice();
            if (printerDevice != null) return;
        }

        // 3. Try POSTerminal class from the SDK
        log("--- Trying POSTerminal class ---");
        if (tryPOSTerminalClass()) return;

        // 4. Scan SDK DEX for printer classes and try them as device names
        log("--- Scanning SDK for printer device names ---");
        if (trySdkPrinterDiscovery()) return;

        throw new Exception("Could not get printer device.\n" + fullLog);
    }

    /**
     * Get the printer via Android's ServiceManager.getService("Printer").
     */
    private boolean tryPrinterSystemService() {
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            Method getService = sm.getMethod("getService", String.class);

            Object svc = getService.invoke(null, "Printer");
            if (svc == null) {
                log("ServiceManager(\"Printer\") => null");
                return false;
            }
            if (!(svc instanceof IBinder)) {
                log("ServiceManager(\"Printer\") => not IBinder: " + svc.getClass().getName());
                return false;
            }

            IBinder binder = (IBinder) svc;
            String desc = binder.getInterfaceDescriptor();
            log("Printer binder found, desc=\"" + desc + "\"");

            // Try known AIDL interface class names for the Printer service
            String[] candidates = {
                "android.os.IPrinterService",
                "android.os.IPrinter",
                "com.wizarpos.IPrinterService",
                "com.wizarpos.printer.IPrinterService",
                "com.wizarpos.service.IPrinterService",
                "com.smartpos.IPrinterService",
                "android.hardware.IPrinterService",
                "com.android.server.IPrinterService",
                "com.pos.IPrinterService",
                "android.os.IInnerPrinter",
                "com.wizarpos.IInnerPrinter"
            };

            // Also scan /system/framework/ for printer JARs
            log("--- Scanning /system/framework/ ---");
            java.io.File fwDir = new java.io.File("/system/framework");
            if (fwDir.exists() && fwDir.isDirectory()) {
                java.io.File[] files = fwDir.listFiles();
                if (files != null) {
                    for (java.io.File f : files) {
                        String fn = f.getName().toLowerCase();
                        if (fn.contains("print") || fn.contains("wizarpos")
                                || fn.contains("smartpos") || fn.contains("cloudpos")) {
                            log("  " + f.getName() + " (" + f.length() + " bytes)");
                        }
                    }
                }
                // Also list all JARs for reference
                log("All framework JARs:");
                if (files != null) {
                    for (java.io.File f : files) {
                        if (f.getName().endsWith(".jar")) {
                            log("  " + f.getName());
                        }
                    }
                }
            }

            // Scan framework DEX/JARs for printer classes
            log("--- Scanning BOOTCLASSPATH for printer classes ---");
            String bootcp = System.getProperty("java.boot.class.path", "");
            if (!bootcp.isEmpty()) {
                for (String path : bootcp.split(":")) {
                    try {
                        dalvik.system.DexFile dex = new dalvik.system.DexFile(path);
                        java.util.Enumeration<String> entries = dex.entries();
                        while (entries.hasMoreElements()) {
                            String cls = entries.nextElement();
                            String lower = cls.toLowerCase();
                            if ((lower.contains("printer") || lower.contains("innerprint"))
                                    && !lower.contains("fingerprint") && !lower.contains("bouncycastle")
                                    && !lower.contains("android.support") && !lower.contains("androidx")) {
                                log("  " + cls + " (from " + new java.io.File(path).getName() + ")");
                                // Add to candidates
                                if (cls.contains("$Stub")) {
                                    String iface = cls.replace("$Stub", "");
                                    log("  => candidate interface: " + iface);
                                }
                            }
                        }
                        dex.close();
                    } catch (Exception ignored) {}
                }
            } else {
                log("  BOOTCLASSPATH not available");
            }

            // Try each candidate as Stub
            log("--- Trying Stub candidates ---");
            for (String iface : candidates) {
                try {
                    Class<?> stubClass = Class.forName(iface + "$Stub");
                    Method asInterface = stubClass.getMethod("asInterface", IBinder.class);
                    printerDevice = asInterface.invoke(null, binder);
                    log("SUCCESS: " + iface);
                    log("  Proxy: " + printerDevice.getClass().getName());
                    for (Method m : printerDevice.getClass().getMethods()) {
                        String n = m.getName();
                        if (!n.equals("hashCode") && !n.equals("equals") && !n.equals("toString")
                                && !n.equals("getClass") && !n.equals("notify") && !n.equals("notifyAll")
                                && !n.equals("wait") && !n.equals("asBinder") && !n.equals("getInterfaceDescriptor")) {
                            log("    " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                        }
                    }
                    tryOpenMethod();
                    return true;
                } catch (ClassNotFoundException ignored) {
                } catch (Exception e) {
                    log("  " + iface + " err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            }

            // Try raw transact — capture SecurityException message for permission info
            log("--- Trying raw transact (first 3 only) ---");
            for (int code = 1; code <= 3; code++) {
                try {
                    Parcel data = Parcel.obtain();
                    Parcel reply = Parcel.obtain();
                    data.writeInterfaceToken(desc != null ? desc : "");
                    boolean ok = binder.transact(code, data, reply, 0);
                    if (ok) {
                        log("  transact(" + code + ") => ok");
                    }
                    data.recycle();
                    reply.recycle();
                } catch (SecurityException e) {
                    log("  transact(" + code + ") => SEC: " + e.getMessage());
                } catch (Exception e) {
                    log("  transact(" + code + ") => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            }

            // Don't use raw binder as printerDevice — it has no print methods
            // Try SystemExtApiService instead
            log("--- Trying SystemExtApiService ---");
            if (tryWizarPosAgentService("com.wizarpos.wizarviewagentassistant",
                    "com.wizarpos.wizarviewagentassistant.SystemExtApiService")) return true;
            if (tryWizarPosAgentService("com.wizarpos.wizarviewagentassistant",
                    "com.wizarpos.wizarviewagentassistant.SystemHideApiService")) return true;

            return false;

        } catch (Exception e) {
            log("ServiceManager err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
        return false;
    }

    private boolean tryWizarPosAgentService(String packageName, String serviceName) {
        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(packageName, serviceName));

            final CountDownLatch latch = new CountDownLatch(1);
            final IBinder[] binderHolder = new IBinder[1];

            ServiceConnection conn = new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder binder) {
                    binderHolder[0] = binder;
                    latch.countDown();
                }
                @Override
                public void onServiceDisconnected(ComponentName name) {}
            };

            boolean bindOk = appContext.bindService(intent, conn, Context.BIND_AUTO_CREATE);
            log("bind(" + serviceName + ")=" + bindOk);

            if (!bindOk) return false;

            if (!latch.await(4, TimeUnit.SECONDS)) {
                log("timeout waiting for " + serviceName);
                try { appContext.unbindService(conn); } catch (Exception ignored) {}
                return false;
            }

            IBinder binder = binderHolder[0];
            String desc = binder.getInterfaceDescriptor();
            log("Agent service desc=" + desc);

            if (desc == null || desc.isEmpty()) {
                try { appContext.unbindService(conn); } catch (Exception ignored) {}
                return false;
            }

            // Try loading Stub from agent package classloader, SDK classloader, then system classloader
            Class<?> stubClass = null;
            try {
                Context agentCtx = appContext.createPackageContext(packageName,
                        Context.CONTEXT_INCLUDE_CODE | Context.CONTEXT_IGNORE_SECURITY);
                stubClass = agentCtx.getClassLoader().loadClass(desc + "$Stub");
            } catch (Exception ignored) {}
            if (stubClass == null) {
                try {
                    if (sdkClassLoader != null) stubClass = sdkClassLoader.loadClass(desc + "$Stub");
                } catch (ClassNotFoundException ignored) {}
            }
            if (stubClass == null) {
                try { stubClass = Class.forName(desc + "$Stub"); } catch (ClassNotFoundException ignored) {}
            }

            if (stubClass == null) {
                log("No Stub class found for " + desc);
                try { appContext.unbindService(conn); } catch (Exception ignored) {}
                return false;
            }

            Method asInterface = stubClass.getMethod("asInterface", IBinder.class);
            Object proxy = asInterface.invoke(null, binder);
            log("Agent proxy: " + proxy.getClass().getName());

            // List methods
            for (Method m : proxy.getClass().getMethods()) {
                String n = m.getName();
                if (!n.equals("hashCode") && !n.equals("equals") && !n.equals("toString")
                        && !n.equals("getClass") && !n.equals("notify") && !n.equals("notifyAll")
                        && !n.equals("wait") && !n.equals("asBinder") && !n.equals("getInterfaceDescriptor")) {
                    log("  " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                }
            }

            // Try to get printer device from this proxy
            for (Method m : proxy.getClass().getMethods()) {
                String n = m.getName().toLowerCase();
                if (n.contains("printer") || n.equals("getdevice")) {
                    try {
                        Object result;
                        if (m.getParameterTypes().length == 0) {
                            result = m.invoke(proxy);
                        } else if (m.getParameterTypes().length == 1 && m.getParameterTypes()[0] == String.class) {
                            result = m.invoke(proxy, "cloudpos-printer");
                        } else {
                            continue;
                        }
                        if (result != null) {
                            log("Agent " + m.getName() + " => " + result.getClass().getName());
                            setupPrinterDevice(result);
                            activeConn = conn;
                            return true;
                        }
                    } catch (Exception e) {
                        log("Agent " + m.getName() + " err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    }
                }
            }

            try { appContext.unbindService(conn); } catch (Exception ignored) {}
            return false;
        } catch (Exception e) {
            log("tryWizarPosAgentService(" + serviceName + ") err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            return false;
        }
    }

    /** Invoke a method with a timeout to prevent hanging */
    private Object invokeWithTimeout(Method m, Object target, Object[] args, int timeoutSec) throws Exception {
        ExecutorService exec = Executors.newSingleThreadExecutor();
        try {
            Future<Object> future = exec.submit(() -> m.invoke(target, args));
            return future.get(timeoutSec, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            log("  TIMEOUT after " + timeoutSec + "s");
            return null;
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof InvocationTargetException) throw (InvocationTargetException) cause;
            if (cause instanceof Exception) throw (Exception) cause;
            throw e;
        } finally {
            exec.shutdownNow();
        }
    }

    private Exception tryServiceGetDevice() {
        Exception lastErr = null;
        for (Method m : serviceProxy.getClass().getMethods()) {
            if (!m.getName().equals("getDevice")) continue;

            Class<?>[] paramTypes = m.getParameterTypes();
            log("getDevice(" + paramsToString(paramTypes) + ") => " + m.getReturnType().getSimpleName());

            if (paramTypes.length == 1 && paramTypes[0] == String.class) {
                String[] names = {
                    // Friendly names (POSTerminal style)
                    "cloudpos-printer",
                    "com.cloudpos.device.printer",
                    "printer", "Printer",
                    "com.cloudpos.printer",
                    "thermal_printer", "inner_printer",
                    "builtin_printer",
                    // AIDL interface descriptor style
                    "com.cloudpos.aidl.printer.IPrinter",
                    "com.cloudpos.aidl.printer",
                    "com.cloudpos.advance.ext.printer.IPrinter",
                    "com.cloudpos.advance.printer.IPrinter",
                    "com.cloudpos.sdk.printer.IPrinter",
                    "com.cloudpos.jniinterface.printer",
                    "com.cloudpos.printer.IPrinter",
                    "com.cloudpos.printer.PrinterDevice",
                    // Other patterns
                    "com.cloudpos.device.builtinprinter",
                    "com.cloudpos.device.thermal_printer",
                    "InnerPrinter",
                    "ThermalPrinter",
                    "BuiltInPrinter"
                };
                for (String name : names) {
                    try {
                        Object result = invokeWithTimeout(m, serviceProxy, new Object[]{name}, 3);
                        if (result != null) {
                            log(name + " => GOT IT: " + result.getClass().getName());
                            setupPrinterDevice(result);
                            return null;
                        } else {
                            log(name + " => null");
                        }
                    } catch (InvocationTargetException e) {
                        Throwable cause = e.getCause();
                        String errType = cause != null ? cause.getClass().getSimpleName() : "null";
                        String errMsg = cause != null ? cause.getMessage() : e.getMessage();
                        log(name + " => " + errType + ": " + errMsg);
                        lastErr = e;
                    } catch (Exception e) {
                        log(name + " => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                        lastErr = e;
                    }
                }
            } else if (paramTypes.length == 1 && (paramTypes[0] == int.class || paramTypes[0] == Integer.class)) {
                // Try common device type IDs (printer is often 0, 1, or specific constants)
                int[] typeIds = {0, 1, 2, 3, 4, 5, 10, 100};
                for (int id : typeIds) {
                    try {
                        Object result = invokeWithTimeout(m, serviceProxy, new Object[]{id}, 3);
                        if (result != null) {
                            log("getDevice(" + id + ") => GOT IT: " + result.getClass().getName());
                            setupPrinterDevice(result);
                            return null;
                        } else {
                            log("getDevice(" + id + ") => null");
                        }
                    } catch (InvocationTargetException e) {
                        Throwable cause = e.getCause();
                        String errType = cause != null ? cause.getClass().getSimpleName() : "null";
                        String errMsg = cause != null ? cause.getMessage() : e.getMessage();
                        log("getDevice(" + id + ") => " + errType + ": " + errMsg);
                        lastErr = e;
                    } catch (Exception e) {
                        log("getDevice(" + id + ") => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                        lastErr = e;
                    }
                }
            } else if (paramTypes.length == 0) {
                // No-arg getDevice()
                try {
                    Object result = invokeWithTimeout(m, serviceProxy, new Object[]{}, 3);
                    if (result != null) {
                        log("getDevice() => GOT IT: " + result.getClass().getName());
                        setupPrinterDevice(result);
                        return null;
                    } else {
                        log("getDevice() => null");
                    }
                } catch (Exception e) {
                    log("getDevice() => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    lastErr = e;
                }
            }
        }

        // Also try other method names that might return a printer
        String[] printerMethods = {"getPrinter", "getPrinterDevice", "getInternalDevice",
                "getBuiltinPrinter", "getThermalPrinter", "openPrinter"};
        for (String methodName : printerMethods) {
            Method m = findMethod(serviceProxy, methodName);
            if (m != null) {
                log("Trying " + methodName + "(" + paramsToString(m) + ")");
                try {
                    Object result;
                    if (m.getParameterTypes().length == 0) {
                        result = invokeWithTimeout(m, serviceProxy, new Object[]{}, 3);
                    } else {
                        continue;
                    }
                    if (result != null) {
                        log(methodName + " => GOT IT: " + result.getClass().getName());
                        setupPrinterDevice(result);
                        return null;
                    } else {
                        log(methodName + " => null");
                    }
                } catch (Exception e) {
                    log(methodName + " => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                }
            }
        }

        return lastErr;
    }

    /**
     * Try using the SDK's own POSTerminal class via reflection.
     * This class knows the correct device name mapping internally.
     */
    private boolean tryPOSTerminalClass() {
        if (sdkClassLoader == null || appContext == null) return false;

        // Try known class names for POSTerminal
        String[] terminalClasses = {
            "com.cloudpos.POSTerminal",
            "com.cloudpos.sdk.POSTerminal",
            "com.cloudpos.advance.POSTerminal",
            "com.wizarpos.cloudpos.POSTerminal"
        };

        for (String className : terminalClasses) {
            try {
                Class<?> clz = null;
                try {
                    clz = sdkClassLoader.loadClass(className);
                } catch (ClassNotFoundException ignored) {
                    clz = Class.forName(className); // fallback: app's own classloader (AAR classes)
                }
                log("Loaded " + className);

                // Get instance: POSTerminal.getInstance(context)
                Object terminal = null;
                try {
                    Method getInstance = clz.getMethod("getInstance", Context.class);
                    terminal = getInstance.invoke(null, appContext);
                    log("getInstance(Context) => " + (terminal != null ? terminal.getClass().getName() : "null"));
                } catch (NoSuchMethodException e) {
                    // Try no-arg getInstance
                    try {
                        Method getInstance = clz.getMethod("getInstance");
                        terminal = getInstance.invoke(null);
                        log("getInstance() => " + (terminal != null ? terminal.getClass().getName() : "null"));
                    } catch (Exception e2) {
                        log("No getInstance: " + e2.getMessage());
                    }
                }

                if (terminal == null) continue;

                // List methods on terminal
                log("Terminal methods:");
                for (Method tm : terminal.getClass().getMethods()) {
                    String n = tm.getName();
                    if (n.contains("evice") || n.contains("rinter") || n.contains("open") || n.contains("get")) {
                        if (!n.equals("getClass")) {
                            log("  " + n + "(" + paramsToString(tm) + ") => " + tm.getReturnType().getSimpleName());
                        }
                    }
                }

                // Try getDevice("cloudpos-printer")
                Method getDevice = null;
                try { getDevice = terminal.getClass().getMethod("getDevice", String.class); } catch (Exception ignored) {}

                if (getDevice != null) {
                    String[] devNames = {"cloudpos-printer", "printer", "com.cloudpos.device.printer"};
                    for (String devName : devNames) {
                        try {
                            Object dev = getDevice.invoke(terminal, devName);
                            if (dev != null) {
                                log("POSTerminal.getDevice(\"" + devName + "\") => " + dev.getClass().getName());
                                setupPrinterDevice(dev);
                                return true;
                            } else {
                                log("POSTerminal.getDevice(\"" + devName + "\") => null");
                            }
                        } catch (Exception e) {
                            log("POSTerminal.getDevice(\"" + devName + "\") => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                        }
                    }
                }

                return false;
            } catch (ClassNotFoundException ignored) {
                // Try next class name
            } catch (Exception e) {
                log("POSTerminal err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }

        log("No POSTerminal class found in SDK");

        // Try to discover printer-related classes
        tryDiscoverPrinterClasses();

        return false;
    }

    private void setupPrinterDevice(Object result) throws Exception {
        if (result instanceof IBinder) {
            IBinder devBinder = (IBinder) result;
            String desc = devBinder.getInterfaceDescriptor();
            log("IBinder desc=" + desc);
            if (desc != null && !desc.isEmpty() && sdkClassLoader != null) {
                Class<?> stub = sdkClassLoader.loadClass(desc + "$Stub");
                printerDevice = stub.getMethod("asInterface", IBinder.class).invoke(null, devBinder);
                log("Printer proxy created: " + printerDevice.getClass().getName());
            } else {
                printerDevice = result;
            }
        } else {
            printerDevice = result;
            log("Printer device: " + result.getClass().getName());
        }

        // List printer methods
        log("Printer methods:");
        for (Method pm : printerDevice.getClass().getMethods()) {
            String n = pm.getName();
            if (n.startsWith("print") || n.equals("open") || n.equals("close")
                    || n.equals("cutPaper") || n.equals("getStatus") || n.equals("sendData")) {
                log("  " + n + "(" + paramsToString(pm) + ")");
            }
        }

        tryOpenMethod();
    }

    private void tryOpenMethod() {
        try {
            Method openM = findMethod(printerDevice, "open");
            if (openM != null) {
                if (openM.getParameterTypes().length == 1)
                    openM.invoke(printerDevice, 0);
                else
                    openM.invoke(printerDevice);
                log("Printer open() OK");
            } else {
                log("No open() method");
            }
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            log("open() err: " + (cause != null ? cause.getClass().getSimpleName() + ": " + cause.getMessage() : "null"));
        } catch (Exception e) {
            log("open() err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    public void printlnText(String text) throws Exception {
        if (printerDevice == null) throw new Exception("Printer not open");
        Method m = findMethod(printerDevice, "printlnText");
        if (m == null) m = findMethod(printerDevice, "printText");
        if (m == null) m = findMethod(printerDevice, "print");
        if (m != null) {
            m.invoke(printerDevice, text);
        } else {
            StringBuilder sb = new StringBuilder("No print method. Available: ");
            for (Method method : printerDevice.getClass().getMethods()) {
                sb.append(method.getName()).append(" ");
            }
            throw new Exception(sb.toString());
        }
    }

    public void printBitmap(Bitmap bitmap) throws Exception {
        if (printerDevice == null) throw new Exception("Printer not open");
        Method m = findMethod(printerDevice, "printBitmap");
        if (m != null) {
            m.invoke(printerDevice, bitmap);
        } else {
            throw new Exception("No printBitmap method");
        }
    }

    public void cutPaper() throws Exception {
        if (printerDevice == null) throw new Exception("Printer not open");
        Method m = findMethod(printerDevice, "cutPaper");
        if (m != null) {
            if (m.getParameterTypes().length == 1)
                m.invoke(printerDevice, 0);
            else
                m.invoke(printerDevice);
        }
    }

    public void close() {
        if (printerDevice != null) {
            try {
                Method m = findMethod(printerDevice, "close");
                if (m != null) m.invoke(printerDevice);
            } catch (Exception ignored) {}
            printerDevice = null;
        }
        if (activeConn != null && appContext != null) {
            try { appContext.unbindService(activeConn); } catch (Exception ignored) {}
            activeConn = null;
        }
    }

    public String getDiagnostics() {
        return "Device: " + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
                + " (Android " + android.os.Build.VERSION.RELEASE + ")\n" + fullLog;
    }

    private Method findMethod(Object obj, String name) {
        for (Method m : obj.getClass().getMethods()) {
            if (m.getName().equals(name)) return m;
        }
        return null;
    }

    private String paramsToString(Method m) {
        StringBuilder sb = new StringBuilder();
        for (Class<?> p : m.getParameterTypes()) {
            if (sb.length() > 0) sb.append(",");
            sb.append(p.getSimpleName());
        }
        return sb.toString();
    }

    private String paramsToString(Class<?>[] types) {
        StringBuilder sb = new StringBuilder();
        for (Class<?> p : types) {
            if (sb.length() > 0) sb.append(",");
            sb.append(p.getSimpleName());
        }
        return sb.toString();
    }

    /**
     * Search all installed packages for printer AIDL interfaces and try them
     * with the Printer system service binder.
     */
    private boolean trySdkPrinterDiscovery() {
        // 1. List ALL installed packages — find printer-related ones
        log("--- Listing installed packages ---");
        java.util.List<PackageInfo> allPackages = appContext.getPackageManager()
                .getInstalledPackages(0);
        java.util.List<String> printerPackages = new java.util.ArrayList<>();
        for (PackageInfo pi : allPackages) {
            String pkg = pi.packageName;
            String lower = pkg.toLowerCase();
            if (lower.contains("print") || lower.contains("wizarpos") || lower.contains("cloudpos")
                    || lower.contains("smartpos") || lower.contains("pos")) {
                log("  " + pkg);
                printerPackages.add(pkg);
            }
        }

        // 2. Scan each POS-related package's DEX for printer AIDL Stubs
        log("--- Scanning for printer AIDL stubs ---");
        IBinder printerBinder = null;
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            Method getService = sm.getMethod("getService", String.class);
            Object svc = getService.invoke(null, "Printer");
            if (svc instanceof IBinder) printerBinder = (IBinder) svc;
        } catch (Exception e) {
            log("Can't get Printer binder: " + e.getMessage());
        }

        for (String pkg : printerPackages) {
            try {
                android.content.pm.ApplicationInfo ai = appContext.getPackageManager()
                        .getApplicationInfo(pkg, 0);
                dalvik.system.DexFile dex = new dalvik.system.DexFile(ai.sourceDir);
                java.util.Enumeration<String> entries = dex.entries();
                Context pkgCtx = appContext.createPackageContext(pkg,
                        Context.CONTEXT_INCLUDE_CODE | Context.CONTEXT_IGNORE_SECURITY);
                ClassLoader pkgCl = pkgCtx.getClassLoader();

                while (entries.hasMoreElements()) {
                    String cls = entries.nextElement();
                    String lower = cls.toLowerCase();
                    // Look for printer-related Stub classes
                    if ((lower.contains("printer") || lower.contains("innerprint"))
                            && cls.endsWith("$Stub")
                            && !lower.contains("fingerprint")
                            && !lower.contains("android.support")
                            && !lower.contains("androidx")
                            && !lower.contains("bouncycastle")) {
                        log("  Found Stub: " + cls + " (in " + pkg + ")");

                        // Try to use this Stub with the Printer system binder
                        if (printerBinder != null) {
                            try {
                                Class<?> stubClass = pkgCl.loadClass(cls);
                                Method asInterface = stubClass.getMethod("asInterface", IBinder.class);
                                Object proxy = asInterface.invoke(null, printerBinder);
                                if (proxy != null) {
                                    log("  Proxy created: " + proxy.getClass().getName());
                                    // Check if it has print methods
                                    boolean hasPrint = false;
                                    for (Method m : proxy.getClass().getMethods()) {
                                        String n = m.getName();
                                        if (n.contains("print") || n.contains("Print")
                                                || n.equals("sendData") || n.equals("writeData")) {
                                            hasPrint = true;
                                            log("    " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                                        }
                                    }
                                    if (hasPrint) {
                                        printerDevice = proxy;
                                        log("  PRINTER FOUND via " + cls);
                                        tryOpenMethod();
                                        return true;
                                    }
                                    // Log all methods even if no print found
                                    log("  All methods:");
                                    for (Method m : proxy.getClass().getMethods()) {
                                        String n = m.getName();
                                        if (!n.equals("hashCode") && !n.equals("equals") && !n.equals("toString")
                                                && !n.equals("getClass") && !n.equals("notify") && !n.equals("notifyAll")
                                                && !n.equals("wait") && !n.equals("asBinder") && !n.equals("getInterfaceDescriptor")) {
                                            log("    " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                                        }
                                    }
                                }
                            } catch (Exception e) {
                                log("  Stub err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                            }
                        }
                    }
                }
                dex.close();
            } catch (PackageManager.NameNotFoundException ignored) {
            } catch (Exception e) {
                log("  Scan " + pkg + " err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }

        // 3. Re-try Printer system binder with permissions (check if transact works now)
        if (printerBinder != null) {
            log("--- Re-testing Printer binder transact ---");
            try {
                String desc = printerBinder.getInterfaceDescriptor();
                log("Printer binder desc=\"" + desc + "\" alive=" + printerBinder.isBinderAlive());
                for (int code = 1; code <= 5; code++) {
                    try {
                        Parcel data = Parcel.obtain();
                        Parcel reply = Parcel.obtain();
                        data.writeInterfaceToken(""); // empty descriptor
                        boolean ok = printerBinder.transact(code, data, reply, 0);
                        if (ok) {
                            int replyLen = reply.dataSize();
                            log("  transact(" + code + ") => OK, replySize=" + replyLen);
                        }
                        data.recycle();
                        reply.recycle();
                    } catch (SecurityException e) {
                        log("  transact(" + code + ") => SEC: " + e.getMessage());
                    } catch (Exception e) {
                        log("  transact(" + code + ") => " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    }
                }
            } catch (Exception e) {
                log("Binder test err: " + e.getMessage());
            }
        }

        // 4. Try to find and bind to printer services in other packages
        log("--- Trying to bind printer services ---");
        for (String pkg : printerPackages) {
            try {
                PackageInfo pi = appContext.getPackageManager().getPackageInfo(pkg, PackageManager.GET_SERVICES);
                if (pi.services != null) {
                    for (ServiceInfo si : pi.services) {
                        String svcLower = si.name.toLowerCase();
                        if (svcLower.contains("print") && !svcLower.contains("fingerprint")) {
                            log("  Found printer service: " + pkg + "/" + si.name);
                            // Try to bind
                            if (tryBindPrinterService(pkg, si.name)) return true;
                        }
                    }
                }
            } catch (Exception ignored) {}
        }

        return false;
    }

    private boolean tryBindPrinterService(String pkg, String serviceName) {
        try {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(pkg, serviceName));

            final CountDownLatch latch = new CountDownLatch(1);
            final IBinder[] binderHolder = new IBinder[1];

            ServiceConnection conn = new ServiceConnection() {
                @Override
                public void onServiceConnected(ComponentName name, IBinder binder) {
                    binderHolder[0] = binder;
                    latch.countDown();
                }
                @Override
                public void onServiceDisconnected(ComponentName name) {}
            };

            boolean bindOk = appContext.bindService(intent, conn, Context.BIND_AUTO_CREATE);
            log("    bind=" + bindOk);
            if (!bindOk) return false;

            if (!latch.await(4, TimeUnit.SECONDS)) {
                log("    timeout");
                try { appContext.unbindService(conn); } catch (Exception ignored) {}
                return false;
            }

            IBinder binder = binderHolder[0];
            String desc = binder.getInterfaceDescriptor();
            log("    desc=" + desc);

            // Try to create proxy from multiple classloaders
            ClassLoader[] loaders = new ClassLoader[3];
            loaders[0] = null; // will use Class.forName
            try {
                Context pkgCtx = appContext.createPackageContext(pkg,
                        Context.CONTEXT_INCLUDE_CODE | Context.CONTEXT_IGNORE_SECURITY);
                loaders[1] = pkgCtx.getClassLoader();
            } catch (Exception ignored) {}
            loaders[2] = sdkClassLoader;

            if (desc != null && !desc.isEmpty()) {
                for (ClassLoader cl : loaders) {
                    try {
                        Class<?> stubClass;
                        if (cl == null) stubClass = Class.forName(desc + "$Stub");
                        else stubClass = cl.loadClass(desc + "$Stub");
                        Method asInterface = stubClass.getMethod("asInterface", IBinder.class);
                        Object proxy = asInterface.invoke(null, binder);
                        log("    proxy: " + proxy.getClass().getName());
                        // Log methods
                        for (Method m : proxy.getClass().getMethods()) {
                            String n = m.getName();
                            if (n.contains("print") || n.contains("Print") || n.equals("open")
                                    || n.equals("close") || n.equals("sendData") || n.equals("getStatus")) {
                                log("    " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                            }
                        }
                        printerDevice = proxy;
                        activeConn = conn;
                        tryOpenMethod();
                        return true;
                    } catch (ClassNotFoundException ignored) {
                    } catch (Exception e) {
                        log("    proxy err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                    }
                }
            }

            try { appContext.unbindService(conn); } catch (Exception ignored) {}
            return false;
        } catch (Exception e) {
            log("    bind err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            return false;
        }
    }

    /**
     * Scan key WizarPOS packages for printer classes and try system services.
     */
    private void tryDiscoverPrinterClasses() {
        // 1. Scan DEX of key packages for printer classes
        String[] packagesToScan = {
            SDK_PACKAGE,
            "com.wizarpos.wizarviewagentassistant",
            "com.wizarpos.possys",
            "com.smartpos.accessoryagent",
            "com.smartpos.phone.settings"
        };
        for (String pkg : packagesToScan) {
            scanPackageDex(pkg);
        }

        // 2. Try Android ServiceManager for printer system service
        log("--- Trying ServiceManager ---");
        try {
            Class<?> sm = Class.forName("android.os.ServiceManager");
            Method listServices = sm.getMethod("listServices");
            String[] services = (String[]) listServices.invoke(null);
            log("System services containing 'print':");
            for (String svc : services) {
                if (svc.toLowerCase().contains("print")) {
                    log("  " + svc);
                }
            }
            // Also check for common printer service names
            String[] printerSvcNames = {"printer", "thermal_printer", "inner_printer",
                    "wizarpos.printer", "pos.printer"};
            Method getService = sm.getMethod("getService", String.class);
            for (String name : printerSvcNames) {
                try {
                    Object svc = getService.invoke(null, name);
                    if (svc != null) {
                        log("ServiceManager.getService(\"" + name + "\") => " + svc.getClass().getName());
                        if (svc instanceof IBinder) {
                            String desc = ((IBinder) svc).getInterfaceDescriptor();
                            log("  desc=" + desc);
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            log("ServiceManager err: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        // 3. Check /dev/ for printer devices
        log("--- Checking /dev/ ---");
        String[] devPaths = {"/dev/ttyS1", "/dev/ttyS2", "/dev/ttyS3",
                "/dev/usblp0", "/dev/thermal", "/dev/printer"};
        for (String path : devPaths) {
            java.io.File f = new java.io.File(path);
            if (f.exists()) {
                log("  EXISTS: " + path + " (r=" + f.canRead() + " w=" + f.canWrite() + ")");
            }
        }
    }

    private void scanPackageDex(String pkg) {
        log("--- Scanning " + pkg + " ---");
        try {
            android.content.pm.ApplicationInfo ai = appContext.getPackageManager()
                    .getApplicationInfo(pkg, 0);
            dalvik.system.DexFile dex = new dalvik.system.DexFile(ai.sourceDir);
            java.util.Enumeration<String> entries = dex.entries();

            java.util.List<String> relevant = new java.util.ArrayList<>();
            while (entries.hasMoreElements()) {
                String cls = entries.nextElement();
                String lower = cls.toLowerCase();
                if (lower.contains("print") || lower.contains("thermal")
                        || lower.contains("innerprt") || lower.contains("receipt")) {
                    relevant.add(cls);
                }
            }
            dex.close();

            if (relevant.isEmpty()) {
                log("  No printer classes found");
            } else {
                java.util.Collections.sort(relevant);
                for (String cls : relevant) {
                    log("  " + cls);
                    // Try to load and show methods
                    try {
                        Context pkgCtx = appContext.createPackageContext(pkg,
                                Context.CONTEXT_INCLUDE_CODE | Context.CONTEXT_IGNORE_SECURITY);
                        Class<?> clz = pkgCtx.getClassLoader().loadClass(cls);
                        for (Method m : clz.getDeclaredMethods()) {
                            String n = m.getName();
                            if (n.contains("print") || n.contains("open") || n.contains("close")
                                    || n.contains("init") || n.contains("get") || n.contains("send")
                                    || n.contains("write") || n.contains("cut") || n.contains("status")) {
                                log("    " + n + "(" + paramsToString(m) + ") => " + m.getReturnType().getSimpleName());
                            }
                        }
                    } catch (Exception ignored) {}
                }
            }
        } catch (PackageManager.NameNotFoundException e) {
            log("  Package not found");
        } catch (Exception e) {
            log("  " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }
}
