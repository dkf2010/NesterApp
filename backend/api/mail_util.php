<?php
// backend/api/mail_util.php

require_once dirname(__DIR__) . '/config.php';

/**
 * Sends a transactional email with proper MIME headers, UTF-8 encoding, and security best practices.
 *
 * @param string $to Recipient email address
 * @param string $subject Subject line
 * @param string $body Body text (plain text)
 * @param array $options Optional settings (e.g. from_address, from_name, reply_to)
 * @return bool True if mail was accepted for delivery, false otherwise
 */
function send_app_mail($to, $subject, $body, array $options = [])
{
    $defaultFrom = get_config('MAIL_FROM_ADDRESS', 'info@hamburgerstadttauben.de');
    $defaultFromName = get_config('MAIL_FROM_NAME', 'Hamburger Stadttauben e.V.');

    $fromAddress = $options['from_address'] ?? $defaultFrom;
    $fromName = $options['from_name'] ?? $defaultFromName;
    $replyTo = $options['reply_to'] ?? $fromAddress;

    // MIME-encode from-name and subject to adhere to RFC 2047 and prevent spam penalties
    if (function_exists('mb_encode_mimeheader')) {
        $encodedFromName = mb_encode_mimeheader($fromName, 'UTF-8', 'B');
        $encodedSubject = mb_encode_mimeheader($subject, 'UTF-8', 'B');
    } else {
        $encodedFromName = '=?UTF-8?B?' . base64_encode($fromName) . '?=';
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    }

    // Append clean footer/signature if not already present
    $footer = "\n\n--\n" .
        "Hamburger Stadttauben e. V.\n" .
        "Web: https://hamburgerstadttauben.de\n" .
        "Kontakt: " . $fromAddress . "\n\n" .
        "Hinweis: Dies ist eine automatische Benachrichtigung der NesterApp.";

    if (strpos($body, 'Hamburger Stadttauben') === false) {
        $body .= $footer;
    }

    // Build standard-compliant MIME headers (omit X-Mailer to reduce spam score)
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: ' . $encodedFromName . ' <' . $fromAddress . '>',
        'Reply-To: ' . $replyTo,
    ];

    $headerStr = implode("\r\n", $headers);

    // Pass envelope sender via -f parameter to align SPF/Return-Path
    $additionalParams = '';
    if (filter_var($fromAddress, FILTER_VALIDATE_EMAIL)) {
        $additionalParams = '-f ' . escapeshellarg($fromAddress);
    }

    if (!empty($additionalParams)) {
        return @mail($to, $encodedSubject, $body, $headerStr, $additionalParams);
    }

    return @mail($to, $encodedSubject, $body, $headerStr);
}
