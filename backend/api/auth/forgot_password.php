<?php
// backend/api/auth/forgot_password.php
require_once dirname(__DIR__) . '/db.php';
require_once dirname(__DIR__) . '/app_logger.php';
require_once dirname(__DIR__) . '/rate_limiter.php';

check_rate_limit($pdo, 'forgot_password', 3, 3600, 3600); // 3 attempts per hour, 1 hour block

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['email'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Email required']);
    exit;
}

try {
    $email = $data['email'];

    // Check if user exists
    $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if (!$stmt->fetch()) {
        // We still return success to prevent email enumeration
        echo json_encode(['success' => true]);
        exit;
    }

    $token = bin2hex(random_bytes(32));
    $tokenId = bin2hex(random_bytes(16));
    $expiresAt = (new DateTime())->modify('+1 hour')->format('Y-m-d H:i:s');

    $insert = $pdo->prepare("INSERT INTO password_resets (id, email, token, expires_at) VALUES (?, ?, ?, ?)");
    $insert->execute([$tokenId, $email, $token, $expiresAt]);

    // Send email
    // Note: To make this robust, the frontend URL should either be hardcoded or passed in (safely).
    // Let's assume the frontend URL is the Origin.
    $domain = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : get_config('APP_URL');
    $resetLink = $domain . "/?reset_token=" . $token;

    $subject = "Passwort zurücksetzen - NesterApp";
    $message = "Hallo,\n\njemand hat ein neues Passwort für Ihren Account angefordert.\nKlicken Sie auf den folgenden Link, um ein neues Passwort zu vergeben:\n\n" . $resetLink . "\n\n(Der Link ist für 1 Stunde gültig.)";
    $mailFrom = get_config('MAIL_FROM_ADDRESS');
    $headers = "From: " . $mailFrom . "\r\n" .
        "Reply-To: " . $mailFrom . "\r\n" .
        "X-Mailer: PHP/" . phpversion();

    if (mail($email, $subject, $message, $headers)) {
        app_log($pdo, 'info', 'auth/forgot_password', "Passwort-Reset-E-Mail gesendet an: {$email}");
        echo json_encode(['success' => true]);
    } else {
        app_log($pdo, 'error', 'auth/forgot_password', "E-Mail-Versand fehlgeschlagen für: {$email}");
        http_response_code(500);
        echo json_encode(['error' => 'Failed to send email']);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>