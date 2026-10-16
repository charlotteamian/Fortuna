package com.fortuna.wealthtracker;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Arrays;
import java.util.Locale;

import javax.net.ssl.SSLException;

/** Retries always start at the verified release URL, never a cached CDN URL or partial file. */
final class UpdateDownloadClient {
    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    interface ProgressListener {
        void onProgress(long downloaded, long total);
    }

    static final class DownloadException extends IOException {
        final String code;
        final boolean retryable;

        DownloadException(String code, String message, boolean retryable) {
            super(message);
            this.code = code;
            this.retryable = retryable;
        }
    }

    private UpdateDownloadClient() {}

    static HttpURLConnection open(URL initialUrl) throws IOException {
        return open(initialUrl, url -> (HttpURLConnection) url.openConnection());
    }

    static HttpURLConnection open(URL initialUrl, ConnectionFactory factory) throws IOException {
        for (int attempt = 0; attempt < 2; attempt += 1) {
            try {
                return openOnce(freshReleaseUrl(initialUrl), factory);
            } catch (IOException error) {
                if (attempt == 0 && isRetryable(error)) continue;
                if (error instanceof DownloadException) throw error;
                throw new DownloadException(failureCode(error), "Cannot connect to the update download server", false);
            }
        }
        throw new IOException("Update connection failed");
    }

    static long download(URL initialUrl, File partial, long maxBytes, ProgressListener progress) throws IOException {
        return download(initialUrl, partial, maxBytes, progress, url -> (HttpURLConnection) url.openConnection());
    }

    static long download(URL initialUrl, File partial, long maxBytes, ProgressListener progress, ConnectionFactory factory) throws IOException {
        for (int attempt = 0; attempt < 2; attempt += 1) {
            try {
                // A retry replaces the whole file, including when a previously signed CDN URL expired.
                removePartial(partial);
                return downloadOnce(freshReleaseUrl(initialUrl), partial, maxBytes, progress, factory);
            } catch (IOException error) {
                removePartial(partial);
                if (attempt == 0 && isRetryable(error)) continue;
                if (error instanceof DownloadException) throw error;
                throw new DownloadException(failureCode(error), "Cannot download the update from the server", false);
            }
        }
        throw new IOException("Update download failed");
    }

    private static long downloadOnce(URL initialUrl, File partial, long maxBytes, ProgressListener progress, ConnectionFactory factory) throws IOException {
        HttpURLConnection connection = openOnce(initialUrl, factory);
        try {
            long totalBytes = connection.getContentLengthLong();
            if (totalBytes > maxBytes) {
                throw new DownloadException("UPDATE_TOO_LARGE", "Update APK is too large", false);
            }
            progress.onProgress(0, totalBytes);
            long downloaded = 0;
            long lastNotificationAt = 0;
            try (InputStream input = connection.getInputStream()) {
                FileOutputStream output;
                try {
                    output = new FileOutputStream(partial, false);
                } catch (IOException error) {
                    throw new DownloadException("UPDATE_STORAGE_FAILED", "Cannot create the update download file", false);
                }
                IOException failure = null;
                try {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        if (read == 0) continue;
                        downloaded += read;
                        if (downloaded > maxBytes) {
                            throw new DownloadException("UPDATE_TOO_LARGE", "Update APK is too large", false);
                        }
                        if (totalBytes >= 0 && downloaded > totalBytes) {
                            throw new DownloadException("INCOMPLETE_UPDATE_DOWNLOAD", "Update download length does not match", true);
                        }
                        try {
                            output.write(buffer, 0, read);
                        } catch (IOException error) {
                            throw new DownloadException("UPDATE_STORAGE_FAILED", "Cannot write the update download file", false);
                        }
                        long now = System.currentTimeMillis();
                        if (now - lastNotificationAt >= 250 || (totalBytes > 0 && downloaded == totalBytes)) {
                            progress.onProgress(downloaded, totalBytes);
                            lastNotificationAt = now;
                        }
                    }
                    if (downloaded <= 0 || (totalBytes >= 0 && downloaded != totalBytes)) {
                        throw new DownloadException("INCOMPLETE_UPDATE_DOWNLOAD", "Update download is incomplete", true);
                    }
                    try {
                        output.getFD().sync();
                    } catch (IOException error) {
                        throw new DownloadException("UPDATE_STORAGE_FAILED", "Cannot save the update download file", false);
                    }
                } catch (IOException error) {
                    failure = error;
                    throw error;
                } finally {
                    try {
                        output.close();
                    } catch (IOException error) {
                        if (failure != null) failure.addSuppressed(error);
                        else throw new DownloadException("UPDATE_STORAGE_FAILED", "Cannot close the update download file", false);
                    }
                }
            }
            return downloaded;
        } finally {
            connection.disconnect();
        }
    }

    private static URL freshReleaseUrl(URL initialUrl) throws IOException {
        // GitHub returns short-lived signed CDN destinations. Ask for a fresh redirect.
        String separator = initialUrl.getQuery() == null ? "?" : "&";
        return new URL(initialUrl.getProtocol(), initialUrl.getHost(), initialUrl.getPort(),
            initialUrl.getFile() + separator + "fortuna_update=" + System.nanoTime());
    }

    private static void removePartial(File partial) throws DownloadException {
        if (partial.exists() && !partial.delete()) {
            throw new DownloadException("UPDATE_STORAGE_FAILED", "Cannot remove the incomplete update download", false);
        }
    }

    private static HttpURLConnection openOnce(URL initialUrl, ConnectionFactory factory) throws IOException {
        URL currentUrl = initialUrl;
        for (int redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
            if (!isTrustedDownloadHost(currentUrl)) {
                throw new DownloadException("UNTRUSTED_UPDATE_REDIRECT", "Update redirected to an untrusted host", false);
            }
            HttpURLConnection connection = factory.open(currentUrl);
            boolean keepOpen = false;
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(60_000);
                connection.setRequestProperty("Cache-Control", "no-cache");
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                connection.setRequestProperty("User-Agent", "Fortuna-Android-Updater");
                int status = connection.getResponseCode();
                if (status == HttpURLConnection.HTTP_OK) {
                    keepOpen = true;
                    return connection;
                }
                if (Arrays.asList(301, 302, 303, 307, 308).contains(status)) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.isEmpty()) {
                        throw new DownloadException("INVALID_UPDATE_REDIRECT", "Update redirect is missing a destination", false);
                    }
                    currentUrl = new URL(currentUrl, location);
                    continue;
                }
                boolean expiredCdnUrl = status == 403 && !"github.com".equalsIgnoreCase(currentUrl.getHost());
                boolean transientFailure = status == 408 || status == 429 || status >= 500 || expiredCdnUrl;
                throw new DownloadException("UPDATE_HTTP_FAILED", "Update server returned HTTP " + status, transientFailure);
            } finally {
                if (!keepOpen) connection.disconnect();
            }
        }
        throw new DownloadException("TOO_MANY_UPDATE_REDIRECTS", "Too many update redirects", false);
    }

    private static boolean isRetryable(IOException error) {
        if (error instanceof DownloadException) return ((DownloadException) error).retryable;
        return !(error instanceof SSLException);
    }

    static String failureCode(Exception error) {
        if (error instanceof DownloadException) return ((DownloadException) error).code;
        if (error instanceof SocketTimeoutException) return "UPDATE_NETWORK_TIMEOUT";
        if (error instanceof SSLException) return "UPDATE_TLS_FAILED";
        return "UPDATE_NETWORK_UNAVAILABLE";
    }

    private static boolean isTrustedDownloadHost(URL url) {
        if (!"https".equalsIgnoreCase(url.getProtocol()) || url.getUserInfo() != null
            || (url.getPort() != -1 && url.getPort() != 443)) return false;
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return "github.com".equals(host) || host.endsWith(".githubusercontent.com");
    }
}
