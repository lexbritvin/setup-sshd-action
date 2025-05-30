# Cross-Platform SSH Server GitHub Action

A GitHub Action that sets up an SSH server on Windows, Linux, or macOS runners with configurable authentication and automatic cleanup.

## Features

- ✅ **Cross-platform**: Works on Windows, Linux, and macOS
- 🔐 **Secure**: Key-based authentication only, no passwords
- 🔑 **Flexible keys**: Use provided keys or fetch from GitHub profiles
- 🧹 **Auto-cleanup**: Automatically disables SSH server in post-action
- ⚙️ **Configurable**: Custom ports, users, and server keys

## Usage

### Basic Example

```yaml
- name: Setup SSH Server
  uses: ./
  with:
    public-keys: |
      ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7... user@example.com
      ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGqtP... user@example.com
```

### Use GitHub Actor's Keys

```yaml
- name: Setup SSH Server with GitHub Keys
  uses: ./
  with:
    use-github-keys: true
    github-actor: ${{ github.actor }}
```

### Custom Configuration

```yaml
- name: Setup SSH Server
  uses: ./
  with:
    port: 2222
    ssh-user: myuser
    server-key: |
      -----BEGIN OPENSSH PRIVATE KEY-----
      b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAlwAAAAdzc2gtcn
      ...
      -----END OPENSSH PRIVATE KEY-----
    public-keys: |
      ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7... user@example.com
```

### Complete Workflow Example

```yaml
name: SSH Server Test
on: [push]

jobs:
  test-ssh:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup SSH Server
      id: ssh
      uses: ./
      with:
        port: 2222
        use-github-keys: true
        public-keys: |
          ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7... additional@example.com
    
    - name: Test SSH Connection
      run: |
        echo "SSH server running on ${{ steps.ssh.outputs.hostname }}:${{ steps.ssh.outputs.port }}"
        echo "Username: ${{ steps.ssh.outputs.username }}"
    
    - name: Your custom steps here
      run: |
        # SSH server is available for your use
        # It will be automatically cleaned up after the job
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `port` | SSH server port | No | `2222` |
| `ssh-user` | SSH username | No | `runner` |
| `server-key` | SSH server private key | No | *Generated* |
| `public-keys` | Authorized public keys (one per line) | No | - |
| `use-github-keys` | Fetch GitHub actor's SSH keys | No | `false` |
| `github-actor` | GitHub username to fetch keys from | No | `$GITHUB_ACTOR` |

## Outputs

| Output | Description |
|--------|-------------|
| `hostname` | SSH server hostname |
| `port` | SSH server port |
| `username` | SSH username |

## Platform-Specific Behavior

### Windows
- Uses Windows OpenSSH Server capability
- Installs via PowerShell if not present
- Configuration stored in `C:\ProgramData\ssh\`
- Uses Windows Service management

### Linux
- Installs `openssh-server` package
- Supports Ubuntu/Debian (apt), CentOS/RHEL/Fedora (yum), Alpine (apk)
- Backs up original `/etc/ssh/sshd_config`
- Uses custom configuration file

### macOS
- Uses built-in SSH daemon
- Configuration stored in user's `.ssh` directory
- Runs with custom configuration

## Security Considerations

- **No password authentication**: Only key-based authentication is allowed
- **Limited access**: Only specified users can connect
- **Custom port**: Runs on non-standard port (default 2222)
- **Automatic cleanup**: SSH server is disabled after job completion
- **Key validation**: Only valid SSH public keys are accepted

## Error Handling

The action will fail if:
- No public keys are provided and `use-github-keys` is false
- SSH server fails to start
- GitHub keys cannot be fetched (when requested)
- Platform-specific SSH installation fails

## Development

To build and package the action:

```bash
npm install
npm run build
```
