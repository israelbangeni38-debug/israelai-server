package com.israelai.admin

/**
 * Single source of truth for admin access on the Android side.
 * israelbangeni38@gmail.com — the one and only owner.
 * Nobody else. Not configurable at runtime.
 */
object AdminConfig {
    private const val OWNER_EMAIL = "israelbangeni38@gmail.com"

    fun isAdmin(email: String?): Boolean =
        email?.trim()?.lowercase() == OWNER_EMAIL

    fun isAdminRole(role: String?): Boolean =
        role == "owner"
}
