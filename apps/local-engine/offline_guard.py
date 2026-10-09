"""Bloque les connexions sortantes autres que localhost dans le moteur en marche."""
import ipaddress
import socket


def is_local(host):
    if host == "localhost": return True
    try: return ipaddress.ip_address(host).is_loopback
    except ValueError: return False


def enable():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_getaddrinfo = socket.getaddrinfo

    def check(address):
        if isinstance(address, tuple) and not is_local(address[0]):
            raise OSError("Connexion Internet bloquée : ce moteur fonctionne uniquement en local. Relancez INSTALLER.cmd si un modèle manque.")

    def connect(self, address):
        check(address); return original_connect(self, address)

    def connect_ex(self, address):
        check(address); return original_connect_ex(self, address)

    def getaddrinfo(host, *args, **kwargs):
        if host is not None and not is_local(host):
            raise OSError("Accès réseau distant bloqué en mode local gratuit")
        return original_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo
