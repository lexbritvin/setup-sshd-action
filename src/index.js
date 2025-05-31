import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { DefaultArtifactClient } from "@actions/artifact";


class SSHServerManager {
  constructor() {
    this.platform = process.platform;
    this.isWindows = this.platform === "win32";
    this.isMacOS = this.platform === "darwin";
    this.isLinux = this.platform === "linux";
    this.sshPort = core.getInput("port") || "2222";
    const inputUser = core.getInput("ssh-user") || ":current";
    this.sshUser = inputUser === ":auto" ? os.userInfo().username : inputUser;
  }

  async run() {
    try {
      core.info(`Setting up SSH server on ${this.platform}`);

      // Install SSH server
      await this.installSSHServer();

      // Configure SSH server
      await this.configureSSHServer();

      // Set up authorized keys
      await this.setupAuthorizedKeys();

      // Start SSH server
      await this.startSSHServer();

      // Export connection info
      await this.exportConnectionInfo();

      core.info("SSH server setup completed successfully");
    } catch (error) {
      core.setFailed(`SSH server setup failed: ${error.message}`);
    }
  }

  async installSSHServer() {
    if (this.isWindows) {
      await this.installWindowsSSH();
    } else if (this.isMacOS) {
      await this.installMacOSSSH();
    } else if (this.isLinux) {
      await this.installLinuxSSH();
    }
  }

  async installWindowsSSH() {
    core.info("Installing OpenSSH Server on Windows");
    try {
      // Install OpenSSH Server
      await exec.exec("powershell", [
        "Add-WindowsCapability -Online -Name OpenSSH.Server",
      ]);

      // Install OpenSSH Client (if needed)
      await exec.exec("powershell", [
        "Add-WindowsCapability -Online -Name OpenSSH.Client",
      ]);

    } catch (error) {
      core.warning(`Windows SSH installation warning: ${error.message}`);
    }
  }

  async installMacOSSSH() {
    core.info("Configuring SSH on macOS (built-in)");
    // SSH is built into macOS, just ensure it's available
    try {
      await exec.exec("which", ["sshd"]);
    } catch (error) {
      throw new Error("SSH daemon not found on macOS");
    }
  }

  async installLinuxSSH() {
    core.info("Installing OpenSSH Server on Linux");
    try {
      // Try different package managers
      const distro = await this.getLinuxDistro();

      try {
        await exec.exec("which", ["sshd"]);
      } catch (error) {
        core.info(`sshd is not installed, installing`);
      }

      if (distro.includes("ubuntu") || distro.includes("debian")) {
        await exec.exec("sudo", ["apt-get", "update", "-q"]);
        await exec.exec("sudo", ["apt-get", "install", "-y", "openssh-server"]);
      } else if (distro.includes("centos") || distro.includes("rhel") || distro.includes("fedora")) {
        await exec.exec("sudo", ["yum", "install", "-y", "openssh-server"]);
      } else if (distro.includes("alpine")) {
        await exec.exec("sudo", ["apk", "add", "openssh-server"]);
      }
    } catch (error) {
      core.warning(`Linux SSH installation warning: ${error.message}`);
    }
  }

  async getLinuxDistro() {
    try {
      const output = await exec.getExecOutput("cat", ["/etc/os-release"]);
      return output.stdout.toLowerCase();
    } catch {
      return "unknown";
    }
  }

  async configureSSHServer() {
    const sshDir = this.getSSHDirectory();

    // Ensure SSH directory exists
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    }

    // Configure based on platform
    if (this.isWindows) {
      await this.configureWindowsSSH();
    } else {
      await this.configureUnixSSH(sshDir);
    }
  }

  async configureWindowsSSH() {
    const sshDir = "C:\\ProgramData\\ssh";
    const configPath = path.join(sshDir, "sshd_config");

    // Create SSH directory if it doesn't exist
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true });
    }

    // Generate server keys.
    await this.generateServerKeys(sshDir);

    // Create sshd_config
    const config = this.generateSSHDConfig("windows");
    fs.writeFileSync(configPath, config);
  }

  async configureUnixSSH(sshDir) {
    const configPath = this.isLinux ? "/etc/ssh/sshd_config" : path.join(sshDir, "sshd_config");

    // Generate or use provided server key
    await this.generateServerKeys(sshDir);

    // Create sshd_config
    const config = this.generateSSHDConfig("unix");
    if (this.isLinux) {
      fs.writeFileSync(`${sshDir}/sshd_config_custom`, config);
    } else {
      fs.writeFileSync(configPath, config);
    }
  }

  generateSSHDConfig(platform) {
    const sshDir = this.getSSHDirectory();

    const authorizedKeysPath = platform === "windows"
      ? "C:\\ProgramData\\ssh\\authorized_keys"
      : path.join(sshDir, "authorized_keys");

    return `
# GitHub Actions SSH Server Configuration
Port ${this.sshPort}
Protocol 2
AuthorizedKeysFile "${authorizedKeysPath}"

# Security settings
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM ${platform === "windows" ? "no" : "yes"}

# Logging
SyslogFacility AUTH
LogLevel INFO

# Connection settings
ClientAliveInterval 60
ClientAliveCountMax 3
MaxAuthTries 3
MaxSessions 2

# Disable unused features
X11Forwarding no
AllowTcpForwarding yes
GatewayPorts no
PermitTunnel no

# Allow specific user
AllowUsers ${this.sshUser}
`.trim();
  }

  async setupAuthorizedKeys() {
    const publicKeys = core.getInput("public-keys");
    const useActorsKeys = core.getBooleanInput("use-actor-ssh-keys");
    const githubActor = process.env.GITHUB_ACTOR;

    let allKeys = [];

    // Add provided public keys
    if (publicKeys) {
      const keys = publicKeys.split("\n").filter(key => key.trim());
      allKeys.push(...keys);
    }

    // Fetch GitHub actor's SSH keys if requested
    if (useActorsKeys && githubActor) {
      try {
        const githubKeys = await this.fetchGitHubKeys(githubActor);
        allKeys.push(...githubKeys);
      } catch (error) {
        core.warning(`Could not fetch GitHub keys: ${error.message}`);
      }
    }

    if (allKeys.length === 0) {
      throw new Error("No public keys provided. Please provide public-keys or enable use-actor-ssh-keys and ensure you have the keys in your account.");
    }

    // Write authorized_keys file
    const authorizedKeysPath = this.getAuthorizedKeysPath();
    const authorizedKeysContent = allKeys.join("\n") + "\n";

    // Ensure directory exists
    const dir = path.dirname(authorizedKeysPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(authorizedKeysPath, authorizedKeysContent, { mode: 0o600 });
    core.info(`Configured ${allKeys.length} authorized keys`);
  }

  async fetchGitHubKeys(username) {
    const url = `https://github.com/${username}.keys`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          if (res.statusCode === 200) {
            const keys = data.trim().split("\n").filter(key => key.trim());
            resolve(keys);
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}`));
          }
        });
      }).on("error", reject);
    });
  }

  async startSSHServer() {
    if (this.isWindows) {
      await this.startWindowsSSH();
    } else if (this.isMacOS) {
      await this.startMacOSSSH();
    } else if (this.isLinux) {
      await this.startLinuxSSH();
    }

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify server is running
    await this.verifySSHServer();
  }

  async startWindowsSSH() {
    core.info("Starting SSH server on Windows");

    // Start SSH service
    await exec.exec("powershell", ["Start-Service sshd"]);
  }

  async startMacOSSSH() {
    core.info("Starting SSH server on macOS");
    const sshDir = this.getSSHDirectory();
    const configPath = path.join(sshDir, "sshd_config");

    // Start sshd with nohup to ensure it survives after Node.js exits
    await exec.exec("sudo", [
      "sh", "-c",
      `nohup /usr/sbin/sshd -f ${configPath} -p ${this.sshPort} > /tmp/sshd.log 2>&1 &`
    ]);
  }

  async startLinuxSSH() {
    core.info("Starting SSH server on Linux");
    const sshDir = this.getSSHDirectory();
    const configPath = path.join(sshDir, "sshd_config_custom");

    // Create privilege separation directory if it doesn't exist
    try {
      await exec.exec("sudo", ["mkdir", "-p", "/run/sshd"]);
    } catch (error) {
      core.warning(`Could not create privilege separation directory: ${error.message}`);
    }

    // Start sshd with nohup to ensure it survives after Node.js exits
    await exec.exec("sudo", [
      "sh", "-c",
      `nohup /usr/sbin/sshd -f ${configPath} -p ${this.sshPort} > /tmp/sshd.log 2>&1 &`
    ]);
  }

  async verifySSHServer() {
    try {
      if (this.isWindows) {
        await exec.exec("", [
          `Test-NetConnection -ComputerName localhost -Port ${this.sshPort}`,
        ]);
      } else {
        await exec.exec("nc", ["-z", "localhost", this.sshPort]);
      }
      core.info(`SSH server is running on port ${this.sshPort}`);
    } catch (error) {
      throw new Error(`SSH server verification failed: ${error.message}`);
    }
  }

  async exportConnectionInfo() {
    const hostname = "localhost";
    core.setOutput("hostname", hostname);
    core.setOutput("port", this.sshPort);
    core.setOutput("username", this.sshUser);

    // Upload server public keys
    await this.uploadServerKeys();

    core.info(`SSH Connection Info:`);
    core.info(`  Host: ${hostname}`);
    core.info(`  Port: ${this.sshPort}`);
    core.info(`  User: ${this.sshUser}`);
    core.info(`  Command: ssh -p ${this.sshPort} ${this.sshUser}@${hostname}`);
  }

  async getServerPublicKeys() {
    const sshDir = this.isWindows ? "C:\\ProgramData\\ssh" : "/etc/ssh";
    const keys = [];
    const keyTypes = ["rsa", "ecdsa", "ed25519"];

    for (const type of keyTypes) {
      const keyPath = path.join(sshDir, `ssh_host_${type}_key.pub`);
      if (fs.existsSync(keyPath)) {
        keys.push({
          type,
          content: fs.readFileSync(keyPath, "utf8"),
        });
      }
    }

    return keys;
  }

  async uploadServerKeys() {
    try {
      const keys = await this.getServerPublicKeys();
      if (keys.length === 0) {
        core.warning("No server public keys found to upload");
        return;
      }

      const artifact = new DefaultArtifactClient();
      const jobName = process.env.GITHUB_JOB || "unknown-job";
      const tempDir = path.join(os.tmpdir(), "ssh-keys");

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Write keys to temporary files
      keys.forEach(key => {
        fs.writeFileSync(
          path.join(tempDir, `${key.type}_host_key.pub`),
          key.content,
        );
      });

      // Upload to artifacts
      await artifact.uploadArtifact(
        `${jobName}-ssh-host-keys`,
        ["*.pub"],
        tempDir,
        { retentionDays: 1 }
      );

      core.info("Uploaded server public keys to artifacts");
    } catch (error) {
      core.warning(`Failed to upload server public keys: ${error.message}`);
    }
  }

  getSSHDirectory() {
    if (this.isWindows) {
      return "C:\\ProgramData\\ssh";
    }
    return path.join(os.homedir(), ".ssh");
  }

  getAuthorizedKeysPath() {
    if (this.isWindows) {
      return "C:\\ProgramData\\ssh\\authorized_keys";
    }
    return path.join(this.getSSHDirectory(), "authorized_keys");
  }

  // Add this method to the SSHServerManager class to generate ED25519 keys
  async generateServerKeys() {
    core.info("Generating SSH server keys");

    try {
      // Generate all server keys.
      if (!this.isWindows) {
        await exec.exec("sudo", ["ssh-keygen", "-A"]);
      } else {
        // On Windows, server keys are generated automatically on service start.
      }

      core.info("Generated server keys");
    } catch (error) {
      core.warning(`Error generating server keys: ${error.message}`);
      throw error;
    }
  }

  // Post-action cleanup
  static async cleanup() {
    const manager = new SSHServerManager();

    try {
      core.info("Cleaning up SSH server...");

      if (manager.isWindows) {
        await exec.exec("powershell", ["Stop-Service sshd -Force"]);
      } else {
        // Kill sshd processes on the custom port
        try {
          await exec.exec("sudo", ["pkill", "-f", `sshd.*-p ${manager.sshPort}`]);
        } catch (error) {
          core.warning(`Could not kill SSH processes: ${error.message}`);
        }
      }

      core.info("SSH server cleanup completed");
    } catch (error) {
      core.warning(`SSH cleanup failed: ${error.message}`);
    }
  }
}

const IsPost = !!core.getState("isPost");

try {
  if (!IsPost) {
    core.saveState("isPost", "true");
    const manager = new SSHServerManager();
    await manager.run();
  } else {
    await SSHServerManager.cleanup();
  }
} catch (error) {
  core.setFailed(`Action failed with error: ${error.message}`);
}
