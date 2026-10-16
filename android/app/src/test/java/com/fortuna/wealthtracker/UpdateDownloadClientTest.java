package com.fortuna.wealthtracker;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import javax.net.ssl.SSLHandshakeException;

import static org.junit.Assert.*;

public class UpdateDownloadClientTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private static URL initialUrl() throws Exception {
        return new URL("https://github.com/charlotteamian/Fortuna/releases/download/v1.8.1/Fortuna-1.8.1-release.apk");
    }

    private static final class Response extends HttpURLConnection {
        final int status;
        final String location;
        final IOException failure;
        boolean disconnected;
        InputStream body = new ByteArrayInputStream(new byte[0]);
        long contentLength = -1;

        Response(URL url, int status, String location, IOException failure) {
            super(url);
            this.status = status;
            this.location = location;
            this.failure = failure;
        }

        @Override public int getResponseCode() throws IOException {
            if (failure != null) throw failure;
            return status;
        }
        @Override public String getHeaderField(String name) { return "Location".equals(name) ? location : null; }
        @Override public long getContentLengthLong() { return contentLength; }
        @Override public InputStream getInputStream() { return body; }
        @Override public void disconnect() { disconnected = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }

    private static Response bodyResponse(URL url, String body, long contentLength) {
        Response response = new Response(url, 200, null, null);
        response.body = new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
        response.contentLength = contentLength;
        return response;
    }

    private static InputStream interruptedBody(IOException failure) {
        ByteArrayInputStream prefix = new ByteArrayInputStream(new byte[]{1, 2, 3});
        return new InputStream() {
            @Override public int read() throws IOException {
                if (prefix.available() == 0) throw failure;
                return prefix.read();
            }
            @Override public int read(byte[] buffer, int offset, int length) throws IOException {
                if (prefix.available() == 0) throw failure;
                return prefix.read(buffer, offset, length);
            }
        };
    }

    @Test
    public void followsLiveGithubCdnShapeWithoutCachingOrAutomaticRedirects() throws Exception {
        List<Response> responses = new ArrayList<>();
        HttpURLConnection result = UpdateDownloadClient.open(initialUrl(), url -> {
            Response response = new Response(url, responses.isEmpty() ? 302 : 200,
                "https://release-assets.githubusercontent.com/github-production-release-asset/asset.apk?signature=fixture", null);
            responses.add(response);
            return response;
        });
        assertEquals(2, responses.size());
        assertTrue(responses.get(0).disconnected);
        assertFalse(responses.get(1).disconnected);
        assertSame(responses.get(1), result);
        assertTrue(responses.get(0).getURL().getQuery().startsWith("fortuna_update="));
        for (Response response : responses) {
            assertFalse(response.getInstanceFollowRedirects());
            assertFalse(response.getUseCaches());
            assertEquals("no-cache", response.getRequestProperty("Cache-Control"));
        }
    }

    @Test
    public void retriesTimeoutFromFreshReleaseUrlAndClosesFailedConnection() throws Exception {
        List<Response> responses = new ArrayList<>();
        UpdateDownloadClient.open(initialUrl(), url -> {
            Response response = new Response(url, 200, null, responses.isEmpty() ? new SocketTimeoutException() : null);
            responses.add(response);
            return response;
        });
        assertEquals(2, responses.size());
        assertTrue(responses.get(0).disconnected);
        assertEquals(initialUrl().getPath(), responses.get(1).getURL().getPath());
        assertNotEquals(responses.get(0).getURL().getQuery(), responses.get(1).getURL().getQuery());
    }

    @Test
    public void reportsTimeoutAfterBoundedRetry() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                return new Response(url, 200, null, new SocketTimeoutException());
            }));
        assertEquals(2, attempts[0]);
        assertEquals("UPDATE_NETWORK_TIMEOUT", error.code);
    }

    @Test
    public void reportsUnreachableHostSeparatelyFromSecurityFailure() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                throw new UnknownHostException();
            }));
        assertEquals(2, attempts[0]);
        assertEquals("UPDATE_NETWORK_UNAVAILABLE", error.code);
    }

    @Test
    public void refreshesExpiredSignedCdnDestinationThroughGithub() throws Exception {
        List<Response> responses = new ArrayList<>();
        UpdateDownloadClient.open(initialUrl(), url -> {
            int hop = responses.size();
            Response response = new Response(url, hop == 0 || hop == 2 ? 302 : hop == 1 ? 403 : 200,
                "https://release-assets.githubusercontent.com/asset.apk?signature=" + hop, null);
            responses.add(response);
            return response;
        });
        assertEquals(4, responses.size());
        assertEquals("github.com", responses.get(2).getURL().getHost());
        assertTrue(responses.get(1).disconnected);
        assertNotEquals(responses.get(0).getURL().getQuery(), responses.get(2).getURL().getQuery());
    }

    @Test
    public void neverRetriesOrOpensUntrustedOrHttpRedirects() throws Exception {
        for (String destination : new String[]{
            "https://example.com/update.apk", "http://release-assets.githubusercontent.com/update.apk",
            "https://release-assets.githubusercontent.com:444/update.apk", "https://user@release-assets.githubusercontent.com/update.apk"
        }) {
            List<Response> responses = new ArrayList<>();
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.open(initialUrl(), url -> {
                    Response response = new Response(url, 302, destination, null);
                    responses.add(response);
                    return response;
                }));
            assertEquals("UNTRUSTED_UPDATE_REDIRECT", error.code);
            assertEquals(1, responses.size());
            assertTrue(responses.get(0).disconnected);
        }
    }

    @Test
    public void preservesTlsValidationWithoutRetryingCertificateFailures() throws Exception {
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.open(initialUrl(), url -> {
                attempts[0] += 1;
                return new Response(url, 200, null, new SSLHandshakeException("fixture certificate failure"));
            }));
        assertEquals(1, attempts[0]);
        assertEquals("UPDATE_TLS_FAILED", error.code);
    }

    @Test
    public void doesNotRetryMissingAssetOrMalformedRedirectResponse() throws Exception {
        for (int status : new int[]{404, 302}) {
            int[] attempts = {0};
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.open(initialUrl(), url -> {
                    attempts[0] += 1;
                    return new Response(url, status, null, null);
                }));
            assertEquals(1, attempts[0]);
            assertEquals(status == 404 ? "UPDATE_HTTP_FAILED" : "INVALID_UPDATE_REDIRECT", error.code);
        }
    }

    @Test
    public void restartsInterruptedReadFromFreshReleaseUrlAndReplacesPartialBytes() throws Exception {
        File partial = new File(temporary.getRoot(), "update.part");
        List<Response> responses = new ArrayList<>();
        List<Long> progress = new ArrayList<>();
        long downloaded = UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> progress.add(bytes), url -> {
            int hop = responses.size();
            Response response;
            if (hop == 0 || hop == 2) {
                response = new Response(url, 302, "https://release-assets.githubusercontent.com/asset.apk?signature=" + hop, null);
            } else if (hop == 1) {
                response = bodyResponse(url, "", 12);
                response.body = interruptedBody(new SocketTimeoutException("read stalled"));
            } else {
                assertFalse(partial.exists());
                response = bodyResponse(url, "complete-apk", 12);
            }
            responses.add(response);
            return response;
        });
        assertEquals(12, downloaded);
        assertEquals("complete-apk", new String(Files.readAllBytes(partial.toPath()), StandardCharsets.UTF_8));
        assertEquals(4, responses.size());
        assertEquals("github.com", responses.get(2).getURL().getHost());
        assertEquals(initialUrl().getPath(), responses.get(2).getURL().getPath());
        assertNotEquals(responses.get(0).getURL().getQuery(), responses.get(2).getURL().getQuery());
        assertEquals(Long.valueOf(0), progress.get(0));
        assertEquals(2, progress.stream().filter(value -> value == 0).count());
        for (Response response : responses) assertTrue(response.disconnected);
    }

    @Test
    public void boundsRepeatedReadFailuresToTwoAttemptsAndRemovesPartialFile() throws Exception {
        for (IOException failure : new IOException[]{new SocketTimeoutException(), new IOException("connection reset")}) {
            File partial = new File(temporary.getRoot(), "failed-update.part");
            int[] attempts = {0};
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> {}, url -> {
                    attempts[0] += 1;
                    Response response = bodyResponse(url, "", 12);
                    response.body = interruptedBody(failure);
                    return response;
                }));
            assertEquals(2, attempts[0]);
            assertEquals(failure instanceof SocketTimeoutException ? "UPDATE_NETWORK_TIMEOUT" : "UPDATE_NETWORK_UNAVAILABLE", error.code);
            assertFalse(partial.exists());
        }
    }

    @Test
    public void retriesShortEmptyAndOvershootingResponsesButNeverRetainsTheirPartialBytes() throws Exception {
        String[] bodies = {"abc", "", "abcde", "abc", ""};
        long[] lengths = {5, 0, 3, 0, -1};
        for (int index = 0; index < bodies.length; index += 1) {
            String body = bodies[index];
            long length = lengths[index];
            File partial = new File(temporary.getRoot(), "length-update.part");
            int[] attempts = {0};
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> {}, url -> {
                    attempts[0] += 1;
                    return bodyResponse(url, body, length);
                }));
            assertEquals("INCOMPLETE_UPDATE_DOWNLOAD", error.code);
            assertEquals(2, attempts[0]);
            assertFalse(partial.exists());
        }
    }

    @Test
    public void acceptsACompleteDownloadAfterAnEarlyEofAndUnknownLengthDownloads() throws Exception {
        for (long length : new long[]{12, -1}) {
            File partial = new File(temporary.getRoot(), "complete-update.part");
            int[] attempts = {0};
            assertEquals(12, UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> {}, url -> {
                attempts[0] += 1;
                return bodyResponse(url, attempts[0] == 1 ? "abc" : "complete-apk", attempts[0] == 1 ? 12 : length);
            }));
            assertEquals(2, attempts[0]);
            assertEquals("complete-apk", new String(Files.readAllBytes(partial.toPath()), StandardCharsets.UTF_8));
        }
    }

    @Test
    public void neverRetriesOversizedDownloadsOrTlsFailuresWhileReading() throws Exception {
        for (int fixture = 0; fixture < 3; fixture += 1) {
            int currentFixture = fixture;
            File partial = new File(temporary.getRoot(), "rejected-update.part");
            int[] attempts = {0};
            UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
                () -> UpdateDownloadClient.download(initialUrl(), partial, 5, (bytes, total) -> {}, url -> {
                    attempts[0] += 1;
                    Response response = bodyResponse(url, "too-many-bytes", currentFixture == 0 ? 20 : -1);
                    if (currentFixture == 2) response.body = interruptedBody(new SSLHandshakeException("certificate failure"));
                    return response;
                }));
            assertEquals(currentFixture == 2 ? "UPDATE_TLS_FAILED" : "UPDATE_TOO_LARGE", error.code);
            assertEquals(1, attempts[0]);
            assertFalse(partial.exists());
        }
    }

    @Test
    public void reportsStorageFailuresWithoutRepeatingTheNetworkRequest() throws Exception {
        File partial = new File(new File(temporary.getRoot(), "missing-directory"), "update.part");
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> {}, url -> {
                attempts[0] += 1;
                return bodyResponse(url, "complete-apk", 12);
            }));
        assertEquals("UPDATE_STORAGE_FAILED", error.code);
        assertEquals(1, attempts[0]);
        assertFalse(partial.exists());
    }

    @Test
    public void sharesOneRetryBudgetBetweenConnectionAndReadFailures() throws Exception {
        File partial = new File(temporary.getRoot(), "budget-update.part");
        int[] attempts = {0};
        UpdateDownloadClient.DownloadException error = assertThrows(UpdateDownloadClient.DownloadException.class,
            () -> UpdateDownloadClient.download(initialUrl(), partial, 100, (bytes, total) -> {}, url -> {
                attempts[0] += 1;
                if (attempts[0] == 1) throw new SocketTimeoutException("connect stalled");
                Response response = bodyResponse(url, "", 12);
                response.body = interruptedBody(new SocketTimeoutException("read stalled"));
                return response;
            }));
        assertEquals("UPDATE_NETWORK_TIMEOUT", error.code);
        assertEquals(2, attempts[0]);
        assertFalse(partial.exists());
    }
}
