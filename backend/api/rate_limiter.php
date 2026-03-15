<?php
// backend/api/rate_limiter.php

/**
 * Check rate limit and block IP if necessary.
 * 
 * @param PDO $pdo Active DB connection
 * @param string $action The action to rate limit (e.g. 'login', 'forgot_password')
 * @param int $max_attempts Maximum allowed attempts before blocking
 * @param int $window_seconds The sliding window in seconds
 * @param int $block_seconds How long to block in seconds after max attempts is reached
 */
function check_rate_limit(PDO $pdo, string $action, int $max_attempts, int $window_seconds, int $block_seconds): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $now_format = (new DateTime())->format('Y-m-d H:i:s');

    // First, cleanup old limits (to keep table small)
    $cleanup = "DELETE FROM rate_limits WHERE window_start < DATE_SUB(NOW(), INTERVAL ? SECOND) AND (blocked_until IS NULL OR blocked_until < NOW())";
    try {
        $stmt_cleanup = $pdo->prepare($cleanup);
        $stmt_cleanup->execute([$window_seconds]);
    } catch (\Throwable $e) {
    }

    try {
        $stmt = $pdo->prepare("SELECT id, attempts, window_start, blocked_until FROM rate_limits WHERE action = ? AND ip_address = ?");
        $stmt->execute([$action, $ip]);
        $record = $stmt->fetch(PDO::FETCH_ASSOC);

        $now = new DateTime();

        if ($record) {
            $blocked_until = $record['blocked_until'] ? new DateTime($record['blocked_until']) : null;
            $window_start = new DateTime($record['window_start']);
            $id = $record['id'];

            // Check if currently blocked
            if ($blocked_until && $blocked_until > $now) {
                http_response_code(429);
                echo json_encode(['error' => 'Too many requests. Please try again later.']);
                exit;
            }

            // Check if outside window (reset)
            if (($now->getTimestamp() - $window_start->getTimestamp()) > $window_seconds) {
                $new_attempts = 1;
                $stmt_update = $pdo->prepare("UPDATE rate_limits SET attempts = ?, window_start = ?, blocked_until = NULL WHERE id = ?");
                $stmt_update->execute([$new_attempts, $now->format('Y-m-d H:i:s'), $id]);
            } else {
                // Inside window, increment attempts
                $new_attempts = $record['attempts'] + 1;

                if ($new_attempts >= $max_attempts) {
                    // Block the user
                    $block_until_str = (new DateTime())->modify("+$block_seconds seconds")->format('Y-m-d H:i:s');
                    $stmt_update = $pdo->prepare("UPDATE rate_limits SET attempts = ?, blocked_until = ? WHERE id = ?");
                    $stmt_update->execute([$new_attempts, $block_until_str, $id]);

                    app_log($pdo, 'warning', "rate_limit/$action", "IP address blocked for exceeding rate limit", ['ip' => $ip]);

                    http_response_code(429);
                    echo json_encode(['error' => 'Too many requests. Please try again later.']);
                    exit;
                } else {
                    $stmt_update = $pdo->prepare("UPDATE rate_limits SET attempts = ? WHERE id = ?");
                    $stmt_update->execute([$new_attempts, $id]);
                }
            }

        } else {
            // Unseen client
            $id = bin2hex(random_bytes(18));
            $stmt_insert = $pdo->prepare("INSERT INTO rate_limits (id, action, ip_address, attempts, window_start, blocked_until) VALUES (?, ?, ?, 1, ?, NULL)");
            $stmt_insert->execute([$id, $action, $ip, $now->format('Y-m-d H:i:s')]);
        }

    } catch (\Throwable $e) {
        // Fail open - don't crash the api if rate limit DB fails
        error_log('[NesterApp] check_rate_limit failed: ' . $e->getMessage());
    }
}
?>