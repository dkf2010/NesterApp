<?php
// backend/config.php

$envPath = dirname(__DIR__) . '/.env';
$env = [];

if (file_exists($envPath)) {
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0)
            continue;
        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            $name = trim($name);
            // Optionally handle quotes around values
            $value = trim($value, " \t\n\r\0\x0B\"'");
            $env[$name] = $value;
        }
    }
}

/**
 * Get a configuration value from the .env file or environment variables.
 *
 * @param string $key The configuration key.
 * @param mixed $default The default value if the key is not found.
 * @return mixed
 */
function get_config($key, $default = null)
{
    global $env;
    if (isset($env[$key])) {
        return $env[$key];
    }

    $val = getenv($key);
    if ($val !== false) {
        return $val;
    }

    if (isset($_ENV[$key])) {
        return $_ENV[$key];
    }

    return $default;
}
