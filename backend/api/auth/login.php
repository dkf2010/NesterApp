<?php
// backend/api/auth/login.php
require_once dirname(__DIR__) . '/db.php';
require_once dirname(__DIR__) . '/app_logger.php';
require_once dirname(__DIR__) . '/rate_limiter.php';

check_rate_limit($pdo, 'login', 5, 300, 900); // 5 attempts per 5 minutes, 15 minute block

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['email']) || !isset($data['password'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Email and password required']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT id, username, email, password_hash, is_admin FROM users WHERE email = ?");
    $stmt->execute([$data['email']]);
    $user = $stmt->fetch();

    if ($user && password_verify($data['password'], $user['password_hash'])) {
        // Generate Token
        $token = bin2hex(random_bytes(32));
        $tokenId = bin2hex(random_bytes(16));

        // Expiry set to 14 days (2 weeks)
        $expiresAt = (new DateTime())->modify('+14 days')->format('Y-m-d H:i:s');

        $insert = $pdo->prepare("INSERT INTO user_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)");
        $insert->execute([$tokenId, $user['id'], $token, $expiresAt]);

        app_log($pdo, 'info', 'auth/login', "Login erfolgreich: {$user['username']}", null, $user['id']);

        echo json_encode([
            'success' => true,
            'token' => $token,
            'expires_at' => $expiresAt,
            'user' => [
                'username' => $user['username'],
                'is_admin' => (bool) $user['is_admin']
            ]
        ]);
    } else {
        $attemptedEmail = htmlspecialchars($data['email'] ?? '');
        app_log($pdo, 'warning', 'auth/login', "Fehlgeschlagener Login-Versuch für: {$attemptedEmail}", [
            'email' => $data['email'] ?? ''
        ]);
        http_response_code(401);
        echo json_encode(['error' => 'Invalid credentials']);
    }
} catch (Exception $e) {
    app_log($pdo, 'error', 'auth/login', 'Datenbankfehler beim Login', ['exception' => $e->getMessage()]);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>