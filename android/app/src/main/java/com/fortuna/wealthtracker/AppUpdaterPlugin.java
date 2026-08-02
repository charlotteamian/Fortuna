package com.fortuna.wealthtracker;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String PREFS_NAME = "fortuna_app_updater";
    private static final String KEY_APK_PATH = "apk_path";
    private static final String KEY_VERSION_NAME = "version_name";
    private static final long MAX_APK_BYTES = 200L * 1024L * 1024L;
    private static final Pattern VERSION_PATTERN = Pattern.compile("^\\d+\\.\\d+\\.\\d+$");
    private static final Pattern INITIAL_PATH_PATTERN = Pattern.compile(
        "^/charlotteamian/Fortuna/releases/download/v(\\d+\\.\\d+\\.\\d+)/Fortuna-(\\d+\\.\\d+\\.\\d+)-release\\.apk$"
    );

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final class UpdateException extends Exception {
        final String code;

        UpdateException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("installPermissionGranted", canInstallPackages());
        File downloaded = downloadedApk();
        String downloadedVersion = prefs().getString(KEY_VERSION_NAME, null);
        if (downloaded != null && downloadedVersion != null) {
            try {
                validateDownloadedApk(downloaded, downloadedVersion);
                result.put("downloadedVersion", downloadedVersion);
            } catch (Exception ignored) {
                clearDownloadedUpdate();
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        String versionName = call.getString("versionName", "");
        try {
            validateInitialUrl(url, versionName);
        } catch (UpdateException error) {
            call.reject(error.getMessage(), error.code);
            return;
        }

        executor.execute(() -> {
            File apk = null;
            try {
                apk = downloadApk(url, versionName);
                validateDownloadedApk(apk, versionName);
                prefs().edit()
                    .putString(KEY_APK_PATH, apk.getAbsolutePath())
                    .putString(KEY_VERSION_NAME, versionName)
                    .apply();
                File verifiedApk = apk;
                mainHandler.post(() -> launchInstaller(call, verifiedApk, versionName));
            } catch (Exception error) {
                if (apk != null) apk.delete();
                String code = error instanceof UpdateException ? ((UpdateException) error).code : "UPDATE_DOWNLOAD_FAILED";
                call.reject(error.getMessage() == null ? "Update download failed" : error.getMessage(), code, error);
            }
        });
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        File apk = downloadedApk();
        String versionName = prefs().getString(KEY_VERSION_NAME, "");
        if (apk == null || versionName == null || versionName.isEmpty()) {
            call.reject("No verified update is available", "NO_DOWNLOADED_UPDATE");
            return;
        }
        executor.execute(() -> {
            try {
                validateDownloadedApk(apk, versionName);
                mainHandler.post(() -> launchInstaller(call, apk, versionName));
            } catch (Exception error) {
                clearDownloadedUpdate();
                String code = error instanceof UpdateException ? ((UpdateException) error).code : "UPDATE_VALIDATION_FAILED";
                call.reject(error.getMessage() == null ? "Update validation failed" : error.getMessage(), code, error);
            }
        });
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || canInstallPackages()) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void validateInitialUrl(String urlValue, String versionName) throws UpdateException {
        if (!VERSION_PATTERN.matcher(versionName).matches()) {
            throw new UpdateException("INVALID_UPDATE_VERSION", "Invalid update version");
        }
        try {
            URL url = new URL(urlValue);
            java.util.regex.Matcher matcher = INITIAL_PATH_PATTERN.matcher(url.getPath());
            boolean valid = "https".equalsIgnoreCase(url.getProtocol())
                && "github.com".equalsIgnoreCase(url.getHost())
                && matcher.matches()
                && versionName.equals(matcher.group(1))
                && versionName.equals(matcher.group(2));
            if (!valid) throw new UpdateException("UNTRUSTED_UPDATE_URL", "Untrusted update URL");
        } catch (UpdateException error) {
            throw error;
        } catch (Exception error) {
            throw new UpdateException("UNTRUSTED_UPDATE_URL", "Untrusted update URL");
        }
    }

    private File downloadApk(String urlValue, String versionName) throws Exception {
        File updateDirectory = new File(getContext().getCacheDir(), "updates");
        if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
            throw new UpdateException("UPDATE_STORAGE_FAILED", "Cannot create update directory");
        }
        clearOldUpdateFiles(updateDirectory);

        File partial = new File(updateDirectory, "Fortuna-" + versionName + "-release.apk.part");
        File target = new File(updateDirectory, "Fortuna-" + versionName + "-release.apk");
        HttpURLConnection connection = openTrustedConnection(new URL(urlValue));
        long totalBytes = connection.getContentLengthLong();
        if (totalBytes > MAX_APK_BYTES) {
            connection.disconnect();
            throw new UpdateException("UPDATE_TOO_LARGE", "Update APK is too large");
        }

        long downloaded = 0;
        long lastNotificationAt = 0;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                downloaded += read;
                if (downloaded > MAX_APK_BYTES) throw new UpdateException("UPDATE_TOO_LARGE", "Update APK is too large");
                output.write(buffer, 0, read);
                long now = System.currentTimeMillis();
                if (now - lastNotificationAt >= 250 || (totalBytes > 0 && downloaded == totalBytes)) {
                    notifyProgress(downloaded, totalBytes);
                    lastNotificationAt = now;
                }
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }

        if (downloaded <= 0 || (totalBytes > 0 && downloaded != totalBytes)) {
            partial.delete();
            throw new UpdateException("INCOMPLETE_UPDATE_DOWNLOAD", "Update download is incomplete");
        }
        if (target.exists() && !target.delete()) {
            partial.delete();
            throw new UpdateException("UPDATE_STORAGE_FAILED", "Cannot replace cached update");
        }
        if (!partial.renameTo(target)) {
            partial.delete();
            throw new UpdateException("UPDATE_STORAGE_FAILED", "Cannot finalize update download");
        }
        notifyProgress(downloaded, downloaded);
        return target;
    }

    private HttpURLConnection openTrustedConnection(URL initialUrl) throws Exception {
        URL currentUrl = initialUrl;
        for (int redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
            if (!isTrustedDownloadHost(currentUrl)) {
                throw new UpdateException("UNTRUSTED_UPDATE_REDIRECT", "Update redirected to an untrusted host");
            }
            HttpURLConnection connection = (HttpURLConnection) currentUrl.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            connection.setRequestProperty("User-Agent", "Fortuna-Android-Updater");
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_OK) return connection;
            if (Arrays.asList(301, 302, 303, 307, 308).contains(status)) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new UpdateException("INVALID_UPDATE_REDIRECT", "Update redirect is missing a destination");
                }
                currentUrl = new URL(currentUrl, location);
                continue;
            }
            connection.disconnect();
            throw new UpdateException("UPDATE_HTTP_FAILED", "Update server returned HTTP " + status);
        }
        throw new UpdateException("TOO_MANY_UPDATE_REDIRECTS", "Too many update redirects");
    }

    private boolean isTrustedDownloadHost(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return "github.com".equals(host) || host.endsWith(".githubusercontent.com");
    }

    private void validateDownloadedApk(File apk, String expectedVersionName) throws Exception {
        PackageManager packageManager = getContext().getPackageManager();
        PackageInfo archiveInfo = packageInfoForArchive(packageManager, apk);
        PackageInfo installedInfo = packageInfoForInstalledApp(packageManager);
        if (archiveInfo == null || installedInfo == null) {
            throw new UpdateException("INVALID_UPDATE_APK", "Cannot read update package information");
        }
        if (!getContext().getPackageName().equals(archiveInfo.packageName)) {
            throw new UpdateException("UPDATE_PACKAGE_MISMATCH", "Update package name does not match Fortuna");
        }
        if (!expectedVersionName.equals(archiveInfo.versionName)) {
            throw new UpdateException("UPDATE_VERSION_MISMATCH", "Update version does not match the release");
        }
        if (versionCode(archiveInfo) <= versionCode(installedInfo)) {
            throw new UpdateException("UPDATE_NOT_NEWER", "Downloaded update is not newer than the installed app");
        }
        Set<String> archiveSigners = signerDigests(archiveInfo);
        Set<String> installedSigners = signerDigests(installedInfo);
        if (archiveSigners.isEmpty() || !archiveSigners.equals(installedSigners)) {
            throw new UpdateException("UPDATE_SIGNATURE_MISMATCH", "Update signature does not match the installed app");
        }
    }

    private PackageInfo packageInfoForArchive(PackageManager packageManager, File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return packageManager.getPackageArchiveInfo(
                apk.getAbsolutePath(),
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES)
            );
        }
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        return packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
    }

    private PackageInfo packageInfoForInstalledApp(PackageManager packageManager) throws PackageManager.NameNotFoundException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return packageManager.getPackageInfo(
                getContext().getPackageName(),
                PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES)
            );
        }
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        return packageManager.getPackageInfo(getContext().getPackageName(), flags);
    }

    @SuppressWarnings("deprecation")
    private Set<String> signerDigests(PackageInfo packageInfo) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (packageInfo.signingInfo == null) return new HashSet<>();
            signatures = packageInfo.signingInfo.getApkContentsSigners();
        } else {
            signatures = packageInfo.signatures;
        }
        Set<String> digests = new HashSet<>();
        if (signatures == null) return digests;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        for (Signature signature : signatures) {
            byte[] bytes = digest.digest(signature.toByteArray());
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte value : bytes) hex.append(String.format(Locale.ROOT, "%02x", value));
            digests.add(hex.toString());
        }
        return digests;
    }

    @SuppressWarnings("deprecation")
    private long versionCode(PackageInfo packageInfo) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? packageInfo.getLongVersionCode() : packageInfo.versionCode;
    }

    private void launchInstaller(PluginCall call, File apk, String versionName) {
        if (!canInstallPackages()) {
            Intent permissionIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            permissionIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
            permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(permissionIntent);
            JSObject result = new JSObject();
            result.put("status", "permission_required");
            result.put("versionName", versionName);
            call.resolve(result);
            return;
        }

        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(installIntent);

        JSObject result = new JSObject();
        result.put("status", "installer_opened");
        result.put("versionName", versionName);
        call.resolve(result);
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void notifyProgress(long downloaded, long total) {
        JSObject progress = new JSObject();
        progress.put("bytesDownloaded", downloaded);
        progress.put("totalBytes", total);
        progress.put("progress", total > 0 ? Math.min(1.0, (double) downloaded / total) : 0);
        notifyListeners("downloadProgress", progress, false);
    }

    private File downloadedApk() {
        String path = prefs().getString(KEY_APK_PATH, null);
        if (path == null) return null;
        File apk = new File(path);
        if (apk.isFile()) return apk;
        prefs().edit().remove(KEY_APK_PATH).remove(KEY_VERSION_NAME).apply();
        return null;
    }

    private void clearOldUpdateFiles(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile()) file.delete();
        }
        clearDownloadedUpdate();
    }

    private void clearDownloadedUpdate() {
        File apk = downloadedApk();
        if (apk != null) apk.delete();
        prefs().edit().remove(KEY_APK_PATH).remove(KEY_VERSION_NAME).apply();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
