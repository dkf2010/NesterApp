<?php
// backend/api/app_logger.php
// Reusable logger that writes structured events to the app_logs table.
// Safe to call from any API endpoint that already has $pdo available.

/**
 * Write an event to the app_logs table.
 *
 * @param PDO    $pdo     Active DB connection
 * @param string $level   'info' | 'warning' | 'error'
 * @param string $context Short identifier, e.g. 'auth/login', 'api/get_nests'
 * @param string $message Human-readable description
 * @param mixed  $details Optional extra data (will be JSON-encoded)
 * @param string|null $user_id  UUID of the acting user, if known
 */
function app_log(PDO $pdo, string $level, string $context, string $message, $details = null, ?string $user_id = null): void
{
    try {
        $id = bin2hex(random_bytes(18));
        $detailsJson = $details !== null ? json_encode($details, JSON_UNESCAPED_UNICODE) : null;
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;

        $stmt = $pdo->prepare(
            "INSERT INTO app_logs (id, level, context, message, details, user_id, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([$id, $level, $context, $message, $detailsJson, $user_id, $ip]);
    } catch (\Throwable $e) {
        // Never let logging break the actual request
        error_log('[NesterApp] app_log failed: ' . $e->getMessage());
    }
}
?>
