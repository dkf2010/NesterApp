<?php
// backend/api/get_app_logs.php
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth/auth_util.php';

// Only admins may read logs
$currentUser = require_auth($pdo);
if (!$currentUser['is_admin']) {
    http_response_code(403);
    echo json_encode(['error' => 'Admin access required']);
    exit;
}

$level = $_GET['level'] ?? null; // 'info' | 'warning' | 'error'
$context = $_GET['context'] ?? null;
$limit = min((int) ($_GET['limit'] ?? 200), 500);

$conditions = [];
$params = [];

if ($level && in_array($level, ['info', 'warning', 'error'])) {
    $conditions[] = 'l.level = ?';
    $params[] = $level;
}

if ($context) {
    $conditions[] = 'l.context LIKE ?';
    $params[] = '%' . $context . '%';
}

$where = count($conditions) > 0 ? 'WHERE ' . implode(' AND ', $conditions) : '';

$sql = "SELECT
            l.id,
            l.level,
            l.context,
            l.message,
            l.details,
            l.ip_address,
            l.created_at,
            u.username
        FROM app_logs l
        LEFT JOIN users u ON u.id = l.user_id
        {$where}
        ORDER BY l.created_at DESC
        LIMIT ?";

$params[] = $limit;

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $logs = $stmt->fetchAll();

    // Parse JSON details back into objects for the frontend
    foreach ($logs as &$log) {
        if ($log['details'] !== null) {
            $decoded = json_decode($log['details'], true);
            $log['details'] = $decoded !== null ? $decoded : $log['details'];
        }
    }
    unset($log);

    echo json_encode($logs);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>