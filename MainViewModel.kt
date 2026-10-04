package com.israelai.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.israelai.data.models.*
import com.israelai.data.network.ApiClient
import com.israelai.data.network.TokenStorage
import com.israelai.data.repository.AppRepository
import com.israelai.data.repository.EmailNotVerifiedException
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val tokenStorage = TokenStorage(app)
    private val apiClient    = ApiClient(
        tokenStorage = tokenStorage,
        baseUrl      = "http://YOUR_SERVER_IP:3000" // ← replace with your server address
    )
    private val repo = AppRepository(apiClient, tokenStorage)

    // ─────────────────────────────────────────────────────────────────────────
    // Auth
    // ─────────────────────────────────────────────────────────────────────────

    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    // ─────────────────────────────────────────────────────────────────────────
    // Chat
    // ─────────────────────────────────────────────────────────────────────────

    private val _chats = MutableStateFlow<List<Chat>>(emptyList())
    val chats: StateFlow<List<Chat>> = _chats.asStateFlow()

    private val _currentChatId = MutableStateFlow<String?>(null)
    val currentChatId: StateFlow<String?> = _currentChatId.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _isAiTyping   = MutableStateFlow(false)
    val isAiTyping: StateFlow<Boolean> = _isAiTyping.asStateFlow()

    private val _streamBuffer = MutableStateFlow("")
    val streamBuffer: StateFlow<String> = _streamBuffer.asStateFlow()

    private val _selectedTier = MutableStateFlow(AiTier.FLASH)
    val selectedTier: StateFlow<AiTier> = _selectedTier.asStateFlow()

    private val _chatError = MutableStateFlow<String?>(null)
    val chatError: StateFlow<String?> = _chatError.asStateFlow()

    // ─────────────────────────────────────────────────────────────────────────
    // Settings
    // ─────────────────────────────────────────────────────────────────────────

    private val _selectedTheme   = MutableStateFlow("blue")
    val selectedTheme: StateFlow<String> = _selectedTheme.asStateFlow()

    private val _customPrompt = MutableStateFlow("")
    val customPrompt: StateFlow<String> = _customPrompt.asStateFlow()

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    private val _adminUsers  = MutableStateFlow<List<AdminUser>>(emptyList())
    val adminUsers: StateFlow<List<AdminUser>> = _adminUsers.asStateFlow()

    private val _adminError  = MutableStateFlow<String?>(null)
    val adminError: StateFlow<String?> = _adminError.asStateFlow()

    private val _adminLoading = MutableStateFlow(false)
    val adminLoading: StateFlow<Boolean> = _adminLoading.asStateFlow()

    private val _actionTarget = MutableStateFlow<String?>(null)
    val actionTarget: StateFlow<String?> = _actionTarget.asStateFlow()

    // ─────────────────────────────────────────────────────────────────────────
    // Init — restore session on app launch
    // ─────────────────────────────────────────────────────────────────────────

    init {
        viewModelScope.launch { restoreSession() }
    }

    private suspend fun restoreSession() {
        repo.restoreSession().fold(
            onSuccess = { user ->
                if (user == null) {
                    _authState.value = AuthState.Unauthenticated
                } else {
                    onUserAuthenticated(user)
                }
            },
            onFailure = { _authState.value = AuthState.Unauthenticated }
        )
    }

    private fun onUserAuthenticated(user: AppUser) {
        _selectedTheme.value = user.theme
        _customPrompt.value  = user.customPrompt
        if (user.needsUsername) {
            _authState.value = AuthState.NeedsUsername
        } else {
            _authState.value = AuthState.Authenticated(user)
            loadChats()
            if (user.isAdmin) loadAdminUsers()
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auth operations
    // ─────────────────────────────────────────────────────────────────────────

    fun register(email: String, password: String) {
        viewModelScope.launch {
            _authError.value = null
            repo.register(email, password).fold(
                onSuccess = { _authState.value = AuthState.NeedsEmailVerification },
                onFailure = { _authError.value = it.message }
            )
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _authError.value = null
            repo.login(email, password).fold(
                onSuccess = { response -> onUserAuthenticated(response.user) },
                onFailure = { err ->
                    when (err) {
                        is EmailNotVerifiedException ->
                            _authState.value = AuthState.NeedsEmailVerification
                        else -> _authError.value = err.message
                    }
                }
            )
        }
    }

    fun logout() {
        viewModelScope.launch {
            repo.logout()
            _authState.value    = AuthState.Unauthenticated
            _chats.value        = emptyList()
            _messages.value     = emptyList()
            _currentChatId.value = null
            _adminUsers.value   = emptyList()
        }
    }

    fun setUsername(username: String) {
        viewModelScope.launch {
            _authError.value = null
            repo.setUsername(username.trim()).fold(
                onSuccess = {
                    repo.restoreSession().getOrNull()?.let { user ->
                        onUserAuthenticated(user)
                    }
                },
                onFailure = { _authError.value = it.message }
            )
        }
    }

    fun clearAuthError() { _authError.value = null }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat operations
    // ─────────────────────────────────────────────────────────────────────────

    private fun loadChats() {
        viewModelScope.launch {
            repo.getChats().onSuccess { _chats.value = it }
        }
    }

    fun newChat() {
        val user = (_authState.value as? AuthState.Authenticated)?.user ?: return
        viewModelScope.launch {
            repo.createChat(_selectedTier.value).fold(
                onSuccess = { chat ->
                    _chats.value     = listOf(chat) + _chats.value
                    _currentChatId.value = chat.id
                    _messages.value  = emptyList()
                },
                onFailure = { _chatError.value = it.message }
            )
        }
    }

    fun selectChat(chatId: String) {
        _currentChatId.value = chatId
        viewModelScope.launch {
            repo.getMessages(chatId).fold(
                onSuccess = { _messages.value = it },
                onFailure = { _chatError.value = it.message }
            )
        }
    }

    fun sendMessage(content: String) {
        if (content.isBlank()) return
        val trimmed = content.trim()

        viewModelScope.launch {
            // Ensure we have an active chat
            val chatId = _currentChatId.value ?: run {
                val chat = repo.createChat(_selectedTier.value).getOrElse {
                    _chatError.value = it.message
                    return@launch
                }
                _chats.value     = listOf(chat) + _chats.value
                _currentChatId.value = chat.id
                _messages.value  = emptyList()
                chat.id
            }

            // Optimistically add user message to UI
            val tempUserMsg = ChatMessage(
                id      = "temp_${System.currentTimeMillis()}",
                chatId  = chatId,
                role    = "user",
                content = trimmed,
                tier    = _selectedTier.value.name,
                createdAt = System.currentTimeMillis()
            )
            _messages.value = _messages.value + tempUserMsg
            _isAiTyping.value  = true
            _streamBuffer.value = ""

            val fullResponse = StringBuilder()

            repo.streamMessage(
                chatId  = chatId,
                content = trimmed,
                tier    = _selectedTier.value,
                onToken = { token ->
                    fullResponse.append(token)
                    _streamBuffer.value = fullResponse.toString()
                },
                onDone  = {
                    _isAiTyping.value  = false
                    _streamBuffer.value = ""

                    // Replace temp messages with real ones from server
                    repo.getMessages(chatId).onSuccess { msgs ->
                        _messages.value = msgs
                    }
                    // Refresh chat list (title may have updated)
                    loadChats()
                },
                onError = { err ->
                    _isAiTyping.value  = false
                    _streamBuffer.value = ""
                    _chatError.value = err
                    // Still reload messages to keep state clean
                    repo.getMessages(chatId).onSuccess { _messages.value = it }
                }
            )
        }
    }

    fun deleteChat(chatId: String) {
        viewModelScope.launch {
            repo.deleteChat(chatId)
            _chats.value = _chats.value.filter { it.id != chatId }
            if (_currentChatId.value == chatId) {
                _currentChatId.value = null
                _messages.value = emptyList()
            }
        }
    }

    fun clearAllChats() {
        viewModelScope.launch {
            repo.deleteAllChats()
            _chats.value         = emptyList()
            _currentChatId.value = null
            _messages.value      = emptyList()
        }
    }

    fun setTier(tier: AiTier) { _selectedTier.value = tier }
    fun clearChatError()       { _chatError.value = null }

    // ─────────────────────────────────────────────────────────────────────────
    // Settings
    // ─────────────────────────────────────────────────────────────────────────

    fun setTheme(key: String) {
        _selectedTheme.value = key
        viewModelScope.launch { repo.updateSettings(theme = key) }
    }

    fun setCustomPrompt(prompt: String) {
        _customPrompt.value = prompt
        viewModelScope.launch { repo.updateSettings(customPrompt = prompt) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    fun loadAdminUsers() {
        viewModelScope.launch {
            _adminLoading.value = true
            repo.getAllUsers().fold(
                onSuccess = { _adminUsers.value = it },
                onFailure = { _adminError.value = it.message }
            )
            _adminLoading.value = false
        }
    }

    fun banUser(userId: String) {
        viewModelScope.launch {
            _actionTarget.value = userId
            repo.banUser(userId).fold(
                onSuccess = { loadAdminUsers() },
                onFailure = { _adminError.value = it.message }
            )
            _actionTarget.value = null
        }
    }

    fun suspendUser(userId: String, days: Int) {
        viewModelScope.launch {
            _actionTarget.value = userId
            repo.suspendUser(userId, days).fold(
                onSuccess = { loadAdminUsers() },
                onFailure = { _adminError.value = it.message }
            )
            _actionTarget.value = null
        }
    }

    fun reinstateUser(userId: String) {
        viewModelScope.launch {
            _actionTarget.value = userId
            repo.reinstateUser(userId).fold(
                onSuccess = { loadAdminUsers() },
                onFailure = { _adminError.value = it.message }
            )
            _actionTarget.value = null
        }
    }

    fun clearAdminError() { _adminError.value = null }
}
